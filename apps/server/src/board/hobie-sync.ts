import type { BoardStore } from "./store";
import type { HobieQueueStore } from "../stores/hobie-queue";
import type { WinsStore } from "../wins/store";

export function wireHobieBoardSync(hobie: HobieQueueStore, board: BoardStore, wins: WinsStore): void {
  hobie.onMutate((ev) => {
    void (async () => {
      if (ev.type === "claim") await board.onHobieClaimed(ev.task);
      if (ev.type === "done") await board.onHobieDone(ev.task, wins);
    })();
  });
}
