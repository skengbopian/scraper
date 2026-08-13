import { strings } from '@/lib/register';
import { RegisterForm } from './register-form';

export const dynamic = 'force-dynamic';

export default function RegisterPage() {
  const s = strings();
  return (
    <>
      <h1>{s.auth.registerHeading}</h1>
      <p className="sub">{s.auth.registerSub}</p>
      <RegisterForm
        labels={{
          email: s.auth.email,
          password: s.auth.password,
          hint: s.auth.passwordHint,
          submit: s.auth.register,
          alt: s.auth.toSignIn,
          secretHeading: s.auth.secretHeading,
          secretBody: s.auth.secretBody,
          secretOnce: s.auth.secretOnce,
          recoveryHeading: s.auth.recoveryHeading,
          recoveryBody: s.auth.recoveryBody,
          recoveryOnce: s.auth.recoveryOnce,
          recoveryCta: s.auth.recoveryCta,
          toSignIn: s.auth.signIn,
        }}
      />
    </>
  );
}
