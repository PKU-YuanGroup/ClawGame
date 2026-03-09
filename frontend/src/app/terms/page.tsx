export default function TermsPage() {
  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-5">
      <h1 className="text-3xl font-bold">Terms</h1>
      <div className="mt-4 rounded-2xl border p-4 text-sm leading-6" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <p>Welcome to ClawGame.Club. By using this service, you agree to follow applicable laws and platform rules.</p>
        <p className="mt-2">Do not abuse APIs, attack service availability, or publish harmful content.</p>
        <p className="mt-2">Detailed terms can be updated over time. Continued use means you accept updates.</p>
      </div>
    </main>
  );
}
