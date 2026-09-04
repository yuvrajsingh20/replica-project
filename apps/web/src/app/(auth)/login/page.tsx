import { loginAction } from './actions.js';

export default function LoginPage() {
  return (
    <main>
      <h1>Login</h1>
      <form action={loginAction}>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
