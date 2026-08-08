import PublicHeader from "@/components/Layout/PublicHeader";

export default function ImpressumPage() {
  return (
    <>
      <PublicHeader />

      <main className="mx-auto max-w-2xl px-6 py-16 sm:px-10 sm:py-20">
        <h1 className="text-3xl font-bold text-text">Impressum</h1>
        <p className="mt-2 font-mono text-[11px] text-accent">
          Platzhalter — vor Veröffentlichung mit echten Angaben ausfüllen.
        </p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-text-dim">
          <section>
            <h2 className="mb-1 font-semibold text-text">Angaben gemäß § 5 TMG</h2>
            <p>
              [Vor- und Nachname bzw. Firmenname]
              <br />
              [Straße und Hausnummer]
              <br />
              [PLZ und Ort]
              <br />
              [Land]
            </p>
          </section>

          <section>
            <h2 className="mb-1 font-semibold text-text">Kontakt</h2>
            <p>
              E-Mail: [deine@email.de]
              <br />
              Telefon: [optional]
            </p>
          </section>

          <section>
            <h2 className="mb-1 font-semibold text-text">Umsatzsteuer-ID</h2>
            <p>[Falls vorhanden: USt-IdNr. gemäß § 27 a Umsatzsteuergesetz — sonst entfernen]</p>
          </section>

          <section>
            <h2 className="mb-1 font-semibold text-text">
              Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV
            </h2>
            <p>[Name und Anschrift wie oben]</p>
          </section>

          <section>
            <h2 className="mb-1 font-semibold text-text">Haftungshinweis</h2>
            <p>
              Alle auf ConsensusIQ dargestellten Daten stammen aus der öffentlich zugänglichen
              SEC-EDGAR-API (sec.gov) und werden ohne Gewähr für Richtigkeit, Vollständigkeit oder
              Aktualität bereitgestellt. Es handelt sich nicht um Finanz- oder Anlageberatung.
              ConsensusIQ steht in keiner Verbindung zur SEC.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
