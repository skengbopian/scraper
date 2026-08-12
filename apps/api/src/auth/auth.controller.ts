import { Body, Controller, Headers, Post } from '@nestjs/common';
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

/**
 * Auth surface (DB mode only — the module is not mounted in in-memory mode).
 * No identity guard here: these routes are how a session comes to exist. Note what is absent:
 * nothing on this surface reads or writes Identity PII — registration creates an UNVERIFIED
 * identity shell, and verification belongs to the ident-provider flow, not to auth.
 */
@Controller('auth')
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

  @Post('logout')
  async logout(@Headers('authorization') auth: string | undefined) {
    await this.service.logout(bearer(auth));
    return { ok: true };
  }
}

function bearer(auth: string | undefined): string {
  return auth?.startsWith('Bearer ') ? auth.slice(7) : '';
}
