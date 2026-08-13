import { strings } from '@/lib/register';
import { SignInForm } from './sign-in-form';

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  const s = strings();
  return (
    <>
      <h1>{s.auth.signInHeading}</h1>
      <p className="sub">{s.auth.signInSub}</p>
      <SignInForm
        labels={{ email: s.auth.email, password: s.auth.password, submit: s.auth.signIn, alt: s.auth.toRegister }}
      />
    </>
  );
}
