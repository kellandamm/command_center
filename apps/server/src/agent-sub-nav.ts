import type { IconName } from "./ui/icons";

export const AGENT_SUB_NAV: Array<{ sectionId: string; href: string; label: string; icon: IconName }> = [
  { sectionId: "board", href: "/agent?view=board", label: "Board", icon: "listTodo" },
  { sectionId: "queue", href: "/agent?view=queue", label: "Queue", icon: "listTodo" },
  { sectionId: "usage", href: "/agent?view=usage", label: "Usage", icon: "barChart" },
  { sectionId: "wins", href: "/agent?view=wins", label: "Wins", icon: "trophy" },
  { sectionId: "assistant", href: "/agent?view=assistant", label: "Assistant", icon: "messageSquare" },
  { sectionId: "activity", href: "/agent?view=activity", label: "Activity", icon: "activity" },
];
