// Start page: every campaign with its state, its open decisions and what it brought so far.
import { listCampaigns } from "../api/queries";
import type { CampaignOverview } from "../api/types";
import { CampaignBadge, Empty, ErrorNote, ExampleBadge, Loading } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { formatDay, formatNumber } from "../lib/format";

function nextStep(campaign: CampaignOverview): string {
  if (campaign.in_review > 0) return `${String(campaign.in_review)} Beiträge warten auf deine Freigabe.`;
  if (campaign.status === "ready") return "Bereit. Ein Klick auf „Freigeben & starten“ setzt den Plan in Gang.";
  if (campaign.status === "running") return "Läuft. Freigegebene Beiträge gehen zum Termin raus.";
  if (campaign.status === "paused") return "Pausiert. Nichts wird veröffentlicht, bis du fortsetzt.";
  if (campaign.status === "done") return "Abgeschlossen. Die Ergebnisse stehen im Bericht.";
  return "Entwurf.";
}

export function Campaigns() {
  const campaigns = useAsync(listCampaigns, []);
  return (
    <div class="stack stack--loose">
      <section class="hero">
        <p class="kicker">Übersicht</p>
        <h1>Kampagnen</h1>
        <p class="muted">
          Hier entscheidest du. Die Recherche läuft nach acht Skills, jede Zahl ist gegen ihre Quelle geprüft. Raus geht nur, was du freigibst.
        </p>
      </section>
      {campaigns.loading && <Loading />}
      <ErrorNote message={campaigns.error} />
      {campaigns.data?.length === 0 && <Empty>Noch keine Kampagne. Lege eine im Arbeitsbereich an und übernimm sie mit „agentic-marketing campaign“.</Empty>}
      <div class="grid">
        {campaigns.data?.map((campaign) => (
          <a key={campaign.id} class={`panel campaign-card ${campaign.is_example ? "example-flag" : ""}`} href={`/kampagne/${campaign.id}`}>
            <div class="spread">
              <CampaignBadge status={campaign.status} />
              {campaign.is_example && <ExampleBadge />}
            </div>
            <h2>{campaign.title}</h2>
            <p class="small">{nextStep(campaign)}</p>
            <div class="kpis">
              <div>
                <div class="kpi__label">Beiträge</div>
                <div class="num">
                  {campaign.published} / {campaign.posts} live
                </div>
              </div>
              <div>
                <div class="kpi__label">Aufrufe</div>
                <div class="num">{formatNumber(campaign.views)}</div>
              </div>
              <div>
                <div class="kpi__label">Klicks</div>
                <div class="num">{formatNumber(campaign.clicks)}</div>
              </div>
              <div>
                <div class="kpi__label">Anfragen</div>
                <div class="num">{formatNumber(campaign.leads)}</div>
              </div>
            </div>
            {campaign.started_at !== null && <p class="small muted">Gestartet am {formatDay(campaign.started_at)}</p>}
          </a>
        ))}
      </div>
    </div>
  );
}
