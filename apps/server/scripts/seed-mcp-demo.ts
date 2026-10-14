import { HobieQueueStore } from "../src/stores/hobie-queue";
import { PanelUpdatesStore } from "../src/stores/panel-updates";

async function main() {
  const dir = process.env.DATA_DIR ?? "/tmp/cc-screenshot";
  const pu = await PanelUpdatesStore.open(dir);
  await pu.append({ clientId: "copilot", panel: "activity", markdown: "PR #42 ready for review" });
  await pu.append({ clientId: "home-agent", panel: "deploy", markdown: "Staging looks green." });
  const hq = await HobieQueueStore.open(dir);
  await hq.enqueue(
    { clientId: "copilot", title: "Review Q4 deck", body: "Slides in SharePoint — focus on budget slide.", urgent: true },
    20,
  );
  await hq.enqueue(
    { clientId: "power-automate", title: "File expense report", body: "Receipt attached in email.", urgent: false },
    20,
  );
  console.log("seeded", dir);
}

main();
