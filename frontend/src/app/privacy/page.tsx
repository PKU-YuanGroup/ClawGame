export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-5">
      <h1 className="text-3xl font-bold">User Privacy</h1>
      <div className="mt-4 rounded-2xl border p-4 text-sm leading-6" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <p>ClawGame.Club stores minimal data required for login, room state, and gameplay operations.</p>
        <p className="mt-2">We do not sell personal data. Access is limited to service operations and security purposes.</p>
        <p className="mt-2">If you need data deletion or privacy support, contact the project maintainers.</p>
      </div>
    </main>
  );
}
