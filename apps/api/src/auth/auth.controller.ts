import { Body, Controller, Delete, Headers, Post, UseFilters } from '@nestjs/common';
import { AuthErrorFilter } from './auth-error.filter.js';
import { AuthService } from './auth.service.js';

class RegisterDto {
  readonly email!: string;
  readonly password!: string;
}
class LoginDto {
  readonly email!: string;
  readonly password!: string;
}
class TotpDto {
  readonly code!: string;
}
class RecoveryDto {
  readonly code!: string;
}

/**
 * Auth surface (DB mode only — the module is not mounted in in-memory mode).
 * No identity guard here: these routes are how a session comes to exist. Note what is absent:
 * nothing on this surface reads or writes Identity PII — registration creates an UNVERIFIED
 * identity shell, and verification belongs to the ident-provider flow, not to auth.
 */
@Controller('auth')
// Every failure on this surface is something a user has to read and act on, so the machine-readable
// reason is translated into their register on the way out — see the filter.
@UseFilters(AuthErrorFilter)
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.service.register(String(dto.email ?? ''), String(dto.password ?? ''));
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.service.login(String(dto.email ?? ''), String(dto.password ?? ''));
  }

  @Post('totp')
  totp(@Headers('authorization') auth: string | undefined, @Body() dto: TotpDto) {
    return this.service.verifyTotpStep(bearer(auth), String(dto.code ?? ''));
  }

  /**
   * Re-confirm the second factor to open high-sensitivity data (docs/06 C2).
   *
   * A separate route from `/auth/totp` on purpose: signing in and re-confirming to open a credit file
   * are different acts, and one endpoint doing both would mean every sign-in silently granted step-up.
   */
  @Post('step-up')
  stepUp(@Headers('authorization') auth: string | undefined, @Body() dto: TotpDto) {
    return this.service.stepUp(bearer(auth), String(dto.code ?? ''));
  }

  /**
   * Redeem a recovery code instead of the TOTP challenge. Completes MFA but deliberately does NOT
   * grant step-up — someone signing in from a code found on paper should not thereby open the file.
   */
  /**
   * Art. 17 erasure. Irreversible, step-up gated, and DELETE rather than POST because that is what
   * it is — the only route in this product that destroys anything.
   *
   * There is no ops sibling and there must not be: an erasure a support agent can perform on a user's
   * behalf is an erasure an attacker can perform on a user's behalf, and unlike every other action
   * here it cannot be undone or contested afterwards.
   */
  @Delete('account')
  eraseAccount(@Headers('authorization') auth: string | undefined) {
    return this.service.eraseAccount(bearer(auth));
  }

  @Post('recovery')
  recovery(@Headers('authorization') auth: string | undefined, @Body() dto: RecoveryDto) {
    return this.service.redeemRecoveryCode(bearer(auth), String(dto.code ?? ''));
  }

  /** Sign out everywhere, including this session — see the service for why it includes the caller. */
  @Post('revoke-all')
  revokeAll(@Headers('authorization') auth: string | undefined) {
    return this.service.revokeAllSessions(bearer(auth));
  }

  @Post('logout')
  async logout(@Headers('authorization') auth: string | undefined) {
    await this.service.logout(bearer(auth));
    return { ok: true };
  }
}

function bearer(auth: string | undefined): string {
  return auth?.startsWith('Bearer ') ? auth.slice(7) : '';
}
