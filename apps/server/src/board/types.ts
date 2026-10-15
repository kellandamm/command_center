export const BOARD_COLUMNS = [
  "Backlog",
  "Ready for Hobie",
  "Waiting",
  "Blocked on me",
  "Done",
] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const READY_FOR_HOBIE: BoardColumn = "Ready for Hobie";
export const WAITING: BoardColumn = "Waiting";
export const DONE: BoardColumn = "Done";
export const BLOCKED_ON_ME: BoardColumn = "Blocked on me";

export interface BoardCard {
  id: string;
  title: string;
  notes: string;
  column: BoardColumn;
  position: number;
  hobieTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CardMoveEvent {
  cardId: string;
  fromCol: BoardColumn | null;
  toCol: BoardColumn;
  at: string;
  title: string;
}
