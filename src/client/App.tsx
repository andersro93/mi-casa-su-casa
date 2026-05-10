import { authClient } from "@server/auth/client";

export function App() {
  const session = authClient.useSession();

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">Mi Casa Su Casa</p>
        <h1>Shared verification inbox, without the chaos.</h1>
        <p className="lede">
          Cloudflare-native shared inbox for families, with provider-scoped
          access and owner-only quarantine review.
        </p>
        <div className="status-card">
          <p className="status-label">Auth session</p>
          <pre>{JSON.stringify(session.data ?? null, null, 2)}</pre>
        </div>
      </section>
    </main>
  );
}
