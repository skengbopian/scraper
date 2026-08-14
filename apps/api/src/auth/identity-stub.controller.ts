import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
// Value import on purpose: Nest resolves the constructor param via emitted metadata, and a
// type-only import degrades that metadata to Function (unresolvable).
import { PrismaClient } from '@prisma/client';
import { AesGcmEnvelopeCrypto, sealAddressLines, sealIdentityFields, type PurposeCipher } from '@scraper/core';
import { DevOnlyGuard } from '../common/dev-only.guard.js';
import { createPurposeCipher } from '../identity/user-key.store.js';
import { kekResolver } from './auth.service.js';

class VerifyStubDto {
  readonly legalName!: string;
  readonly dateOfBirth!: string; // ISO date
  readonly street!: string;
  readonly postalCode!: string;
  readonly city!: string;
}

/**
 * The STUBBED ident-provider callback (dev-only; 404s in production posture). In production this
 * endpoint does not exist: POSTIDENT/eID (docs/02, ADR defaults) verifies the person and *its*
 * webhook writes the verified record. The stub keeps the GATE real while making the flow testable:
 * the caller supplies their own data, the row is marked VERIFIED with providerRef "stub" — and
 * everything downstream (deriveSubject, guards, snapshot binding) treats it exactly like a real
 * verification. The subject is still structurally the CALLER: the row updated is the session
 * user's own Identity; there is no field naming anyone else.
 */
@Controller('identity')
@UseGuards(DevOnlyGuard)
export class IdentityStubController {
  private readonly cipher: PurposeCipher;

  constructor(private readonly db: PrismaClient) {
    this.cipher = createPurposeCipher(db, new AesGcmEnvelopeCrypto(kekResolver()));
  }

  @Post('verify-stub')
  async verifyStub(@Req() req: { userId?: string }, @Body() dto: VerifyStubDto) {
    if (!req.userId) throw new BadRequestException({ error: 'NO_SESSION', message: 'Bitte zuerst anmelden (Login + TOTP).' });
    const dob = new Date(String(dto.dateOfBirth ?? ''));
    if (!dto.legalName || Number.isNaN(dob.getTime()) || !dto.street || !dto.postalCode || !dto.city) {
      throw new BadRequestException({ error: 'INCOMPLETE', message: 'Name, Geburtsdatum und Anschrift werden benötigt.' });
    }
    // Sealed under the caller's own DOSSIER key before it reaches the database. `sealIdentityFields`
    // and `openVerifiedIdentity` are a matched pair in core, so a writer cannot seal under a purpose
    // the reader will not look for — and the userId is the caller's session user, which is what keeps
    // "the subject is structurally the CALLER" true through the encryption layer too.
    const sealed = await sealIdentityFields(this.cipher, req.userId, { legalName: dto.legalName.trim(), dateOfBirth: dob });
    const address = await sealAddressLines(this.cipher, req.userId, {
      street: dto.street.trim(), postalCode: dto.postalCode.trim(), city: dto.city.trim(),
    });
    const identity = await this.db.identity.update({
      where: { userId: req.userId },
      data: {
        status: 'VERIFIED',
        method: 'EID',
        legalNameEnc: sealed.legalNameEnc,
        dateOfBirthEnc: sealed.dateOfBirthEnc,
        verifiedAt: new Date(),
        providerRef: 'stub',
      },
    });
    await this.db.identityAddress.updateMany({ where: { identityId: identity.id, current: true }, data: { current: false } });
    await this.db.identityAddress.create({
      data: {
        identityId: identity.id,
        streetEnc: address.streetEnc, postalCodeEnc: address.postalCodeEnc, cityEnc: address.cityEnc,
        country: 'DE', current: true, verifiedAt: new Date(),
      },
    });
    return { status: 'VERIFIED', provider: 'stub', nextAction: 'CREATE_REQUEST' };
  }
}
