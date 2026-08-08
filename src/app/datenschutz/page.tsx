import PublicHeader from "@/components/Layout/PublicHeader";

export default function DatenschutzPage() {
  return (
    <>
      <PublicHeader />

      <main className="mx-auto max-w-2xl px-6 py-16 sm:px-10 sm:py-20">
        <h1 className="text-3xl font-bold text-text">Datenschutzerklärung</h1>
        <p className="mt-2 font-mono text-[11px] text-accent">
          Entwurf — bitte vor Veröffentlichung von einer fachkundigen Stelle prüfen lassen. Kein
          Ersatz für Rechtsberatung.
        </p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-text-dim">
          <section>
            <h2 className="mb-1 font-semibold text-text">1. Verantwortlicher</h2>
            <p>
              [Name / Firma]
              <br />
              [Anschrift]
              <br />
              E-Mail: [deine@email.de]
            </p>
          </section>

          <section>
            <h2 className="mb-1 font-semibold text-text">2. Welche Daten wir verarbeiten</h2>
            <p>
              <strong className="text-text-dim">Konto &amp; Anmeldung:</strong> Bei der
              Registrierung verarbeitet unser Login-Anbieter Clerk (Clerk Inc., USA) deine
              E-Mail-Adresse und Anmeldedaten. Es gilt zusätzlich die{" "}
              <a
                href="https://clerk.com/legal/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-dim underline hover:text-text"
              >
                Datenschutzerklärung von Clerk
              </a>
              .
            </p>
            <p className="mt-2">
              <strong className="text-text-dim">Zahlungsabwicklung:</strong> Für Abo-Zahlungen
              nutzen wir Lemon Squeezy als Zahlungsdienstleister (Merchant of Record). Lemon
              Squeezy verarbeitet dabei deine Zahlungs- und Rechnungsdaten eigenverantwortlich. Es
              gilt zusätzlich die{" "}
              <a
                href="https://www.lemonsqueezy.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-dim underline hover:text-text"
              >
                Datenschutzerklärung von Lemon Squeezy
              </a>
              .
            </p>
            <p className="mt-2">
              <strong className="text-text-dim">Nutzungsdaten:</strong> Serverseitig speichern wir
              die von dir gewählten Dashboard-Filter nicht dauerhaft personenbezogen. Die
              angezeigten Insider-Transaktionsdaten stammen ausschließlich aus der öffentlichen
              SEC-EDGAR-API und betreffen keine ConsensusIQ-Nutzer.
            </p>
          </section>

          <section>
            <h2 className="mb-1 font-semibold text-text">3. Rechtsgrundlage</h2>
            <p>
              Die Verarbeitung erfolgt zur Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO) — also um
              dir den Login und den bezahlten Dashboard-Zugriff bereitzustellen.
            </p>
          </section>

          <section>
            <h2 className="mb-1 font-semibold text-text">4. Speicherdauer</h2>
            <p>
              Konto- und Abo-Daten werden gespeichert, solange dein Konto besteht bzw. gesetzliche
              Aufbewahrungspflichten (insb. bei Rechnungsdaten über Lemon Squeezy) bestehen.
            </p>
          </section>

          <section>
            <h2 className="mb-1 font-semibold text-text">5. Deine Rechte</h2>
            <p>
              Du hast das Recht auf Auskunft, Berichtigung, Löschung und Einschränkung der
              Verarbeitung deiner Daten sowie auf Datenübertragbarkeit und Widerspruch — wende dich
              dazu an [deine@email.de]. Außerdem besteht ein Beschwerderecht bei einer
              Datenschutz-Aufsichtsbehörde.
            </p>
          </section>

          <section>
            <h2 className="mb-1 font-semibold text-text">6. Empfänger in Drittländern</h2>
            <p>
              Clerk und Lemon Squeezy können Daten auch außerhalb der EU/des EWR (u.a. USA)
              verarbeiten. Beide Anbieter geben an, geeignete Garantien (z.B.
              EU-Standardvertragsklauseln) einzuhalten — Details in den jeweils verlinkten
              Datenschutzerklärungen.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
