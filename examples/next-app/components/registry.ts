import { createRegistry } from "@kibadist/agentui-react";
import { TextBlock } from "./text-block";
import { InfoCard } from "./info-card";
import { ActionCard } from "./action-card";
import { DataTable } from "./data-table";
import { StatusBadge } from "./status-badge";
import {
  textBlockSchema,
  infoCardSchema,
  actionCardSchema,
  dataTableSchema,
  statusBadgeSchema,
} from "./schemas";

export const registry = createRegistry({
  "text-block": { component: TextBlock, propsSchema: textBlockSchema },
  "info-card": { component: InfoCard, propsSchema: infoCardSchema },
  "action-card": { component: ActionCard, propsSchema: actionCardSchema },
  "data-table": { component: DataTable, propsSchema: dataTableSchema },
  "status-badge": { component: StatusBadge, propsSchema: statusBadgeSchema },
});
