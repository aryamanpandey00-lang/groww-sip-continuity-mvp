import type { ComponentType } from "react";
import {
  AlertIcon,
  ChartIcon,
  GiftIcon,
  RefreshIcon,
  SipIcon,
  SlidersIcon,
  type IconProps,
} from "@/components/ui/icons";
import type { AssistantApiRequest } from "@/lib/assistant/contracts";
import type { AssistantDemoScenario } from "@/lib/domain/fixtures/assistant-scenarios";

type AssistantProblemCategory = NonNullable<
  AssistantApiRequest["selectedCategory"]
>;

export interface AssistantJourney {
  id: AssistantProblemCategory;
  title: string;
  description: string;
  starterQuestion: string;
  demoScenario: AssistantDemoScenario;
  scenarioNote: string;
  icon: ComponentType<IconProps>;
}

export const ASSISTANT_JOURNEYS: AssistantJourney[] = [
  {
    id: "INSUFFICIENT_FUNDS",
    title: "Insufficient money this month",
    description: "Understand fictional retry options and demo rules.",
    starterQuestion:
      "I may not have enough money for this month's SIP payment. What fictional retry options and demo rules apply?",
    demoScenario: "BASE",
    scenarioNote: "BASE demo account",
    icon: AlertIcon,
  },
  {
    id: "PAYMENT_FAILED",
    title: "SIP payment failed",
    description: "Get safe guidance about the failed demo payment.",
    starterQuestion:
      "My SIP payment failed. What does the demo say about its status and safe next steps?",
    demoScenario: "BASE",
    scenarioNote: "BASE demo account with a fictional failed cycle",
    icon: SipIcon,
  },
  {
    id: "MARKET_UNCERTAINTY",
    title: "Market uncertainty",
    description: "Learn about volatility and SIP discipline in general.",
    starterQuestion:
      "Markets feel uncertain. Can you explain volatility and long-term SIP discipline in general without predicting returns?",
    demoScenario: "BASE",
    scenarioNote: "General investor education",
    icon: ChartIcon,
  },
  {
    id: "MODIFY_SIP",
    title: "Modify SIP amount or debit date",
    description: "Ask about changing the amount or the debit day.",
    starterQuestion:
      "What fictional demo rules apply to changing my SIP monthly amount or debit day?",
    demoScenario: "BASE",
    scenarioNote: "BASE demo account",
    icon: SlidersIcon,
  },
  {
    id: "RESTART_SIP",
    title: "Restart paused SIP",
    description: "Check the fictional paused SIP restart journey.",
    starterQuestion: "Can I restart my paused SIP in the demo?",
    demoScenario: "PAUSED_RESTART",
    scenarioNote: "PAUSED_RESTART — fictional paused SIP",
    icon: RefreshIcon,
  },
  {
    id: "REWARD_MILESTONE",
    title: "12-month SIP reward progress",
    description: "Ask about the simulated milestone and voucher.",
    starterQuestion:
      "Can you explain the fictional 12-month SIP reward progress and whether the voucher is redeemable?",
    demoScenario: "BASE",
    scenarioNote: "Fictional reward — not redeemable",
    icon: GiftIcon,
  },
];

export function toAssistantRequest(
  question: string,
  journey: Pick<AssistantJourney, "id" | "demoScenario">,
): AssistantApiRequest {
  return {
    question: question.trim(),
    selectedCategory: journey.id,
    demoScenario: journey.demoScenario,
  };
}
