import { signupAction } from './actions.js';

export default function SignupPage() {
  return (
    <main>
      <h1>Sign up</h1>
      <form action={signupAction}>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input name="password" type="password" required autoComplete="new-password" />
        </label>
        <label>
          Workspace name
          <input name="workspaceName" type="text" autoComplete="organization" />
        </label>
        <button type="submit">Create account</button>
      </form>
    </main>
  );
}
