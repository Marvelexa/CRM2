/**
 * Starter flow templates.
 *
 * Three pre-canned flows users can clone with one click instead of
 * building from scratch. Each template is a plain JS object describing
 * the same shape `/api/flows` PUT accepts — name, trigger config,
 * entry_node_id, fallback_policy, nodes[] — keyed by a stable
 * `slug`.
 *
 * The clone path (`/api/flows` POST with `template_slug`) creates a
 * NEW flow_row + flow_nodes rows for the user. `node_key`s are kept
 * verbatim (they're stable strings, not UUIDs, so cloning never
 * needs to rewrite edge references).
 *
 * Choosing a single static module over a DB-backed gallery for v1
 * because: (a) the set is small and changes with code releases, not
 * data; (b) keeps templates portable across self-hosted instances
 * without migrations; (c) editing in source is the lowest-friction
 * way to add the next template.
 */

import type {
  CollectInputNodeConfig,
  ConditionNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
  SendListNodeConfig,
  SendMessageNodeConfig,
  StartNodeConfig,
} from "./types";

export type FlowTemplateNodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "handoff"
  | "end";

export interface FlowTemplateNode {
  node_key: string;
  node_type: FlowTemplateNodeType;
  config:
    | StartNodeConfig
    | SendMessageNodeConfig
    | SendButtonsNodeConfig
    | SendListNodeConfig
    | CollectInputNodeConfig
    | ConditionNodeConfig
    | HandoffNodeConfig
    | Record<string, unknown>;
}

export interface FlowTemplate {
  slug: string;
  name: string;
  description: string;
  /** Used by the gallery to surface a relevant icon. lucide-react name. */
  icon: "MessageSquare" | "HelpCircle" | "UserPlus";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

// ============================================================
// 1. Welcome menu — the example from the owner's brief
// ============================================================
const WELCOME_MENU: FlowTemplate = {
  slug: "welcome_menu",
  name: "Welcome menu",
  description:
    "Greet customers who type a keyword and route them to the right agent based on whether they're new or existing.",
  icon: "MessageSquare",
  trigger_type: "keyword",
  trigger_config: { keywords: ["support", "help", "hi"], match_type: "contains" },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "welcome" },
    },
    {
      node_key: "welcome",
      node_type: "send_buttons",
      config: {
        text: "Hi! 👋 Welcome to support. Are you an existing customer or new here?",
        footer_text: "Tap a button below to continue.",
        buttons: [
          {
            reply_id: "existing",
            title: "Existing customer",
            next_node_key: "existing_handoff",
          },
          {
            reply_id: "new",
            title: "New customer",
            next_node_key: "new_handoff",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "existing_handoff",
      node_type: "handoff",
      config: {
        note: "Existing customer needs assistance — please check account history before replying.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "new_handoff",
      node_type: "handoff",
      config: {
        note: "New customer — share pricing + onboarding link.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 2. FAQ bot — list-message answers, fully automated
// ============================================================
const FAQ_BOT: FlowTemplate = {
  slug: "faq_bot",
  name: "FAQ bot",
  description:
    "Answer common questions automatically. Customer picks a topic from a list; the bot replies with the answer and ends.",
  icon: "HelpCircle",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["faq", "question", "info"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "topics" },
    },
    {
      node_key: "topics",
      node_type: "send_list",
      config: {
        text: "What can I help you with?",
        button_label: "View topics",
        sections: [
          {
            title: "Common questions",
            rows: [
              {
                reply_id: "hours",
                title: "Opening hours",
                next_node_key: "answer_hours",
              },
              {
                reply_id: "pricing",
                title: "Pricing",
                next_node_key: "answer_pricing",
              },
              {
                reply_id: "refunds",
                title: "Refund policy",
                next_node_key: "answer_refunds",
              },
            ],
          },
          {
            title: "Other",
            rows: [
              {
                reply_id: "human",
                title: "Talk to a human",
                next_node_key: "human_handoff",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "answer_hours",
      node_type: "send_message",
      config: {
        text: "We're open Mon–Fri, 9am–6pm local time. Weekend support is limited to urgent issues.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_pricing",
      node_type: "send_message",
      config: {
        text: "Our pricing starts at $9/mo. Visit https://example.com/pricing for the full breakdown.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_refunds",
      node_type: "send_message",
      config: {
        text: "Refunds are honored within 30 days of purchase. Reply with your order number and we'll process it.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "human_handoff",
      node_type: "handoff",
      config: {
        note: "Customer asked to talk to a human from the FAQ bot.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
    },
  ],
};

// ============================================================
// 3. Lead capture — collect_input chain, ends in a handoff
// ============================================================
const LEAD_CAPTURE: FlowTemplate = {
  slug: "lead_capture",
  name: "Lead capture",
  description:
    "Greet first-time inbounds, capture name + email + company, then hand off to sales with the answers in the note.",
  icon: "UserPlus",
  trigger_type: "first_inbound_message",
  trigger_config: {},
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "intro" },
    },
    {
      node_key: "intro",
      node_type: "send_message",
      config: {
        text: "Welcome! 👋 I'll ask a few quick questions so we can get you to the right person.",
        next_node_key: "ask_name",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: "What's your name?",
        var_key: "name",
        next_node_key: "ask_email",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_email",
      node_type: "collect_input",
      config: {
        prompt_text: "Thanks {{vars.name}}! What's your work email?",
        var_key: "email",
        next_node_key: "ask_company",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_company",
      node_type: "collect_input",
      config: {
        prompt_text: "Almost done — what's your company name?",
        var_key: "company",
        next_node_key: "handoff",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "New lead — name={{vars.name}}, email={{vars.email}}, company={{vars.company}}.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 4. Nexvora Price & Outreach Flow
// ============================================================
const NEXVORA_OUTREACH: FlowTemplate = {
  slug: "nexvora_outreach",
  name: "Nexvora Price & Outreach Flow",
  description:
    "Interactive pricing packages by country, business name customization prompt, About Us response, portfolio link CTA, and Not Interested handler.",
  icon: "MessageSquare",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["price", "pricing", "get pricing", "customize", "about us"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "welcome_price_buttons" },
    },
    {
      node_key: "welcome_price_buttons",
      node_type: "send_buttons",
      config: {
        text: "Welcome to Nexvora! Tap Get Pricing to reveal our country-specific packages or choose another option below.",
        buttons: [
          { reply_id: "pricing", title: "Get Pricing", next_node_key: "price_reveal" },
          { reply_id: "customize", title: "Customize Mine", next_node_key: "customize_prompt" },
          { reply_id: "about_us", title: "About Us", next_node_key: "about_us_reply" },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "price_reveal",
      node_type: "send_buttons",
      config: {
        text: "Here are our transparent investment packages tailored to your country:\n\n*💎 Starter - $299 (or ₹8,999 / £249)*\n• Up to 5 Premium Pages, Mobile Optimized\n\n*🚀 Growth - $599 (Most Popular)*\n• Up to 15 Pages, Animations, Lead Capture\n\n*🛍️ Professional - $999*\n• Full E-commerce / Booking System\n\n*👑 Enterprise - $1,500+*\n• Custom UI/UX & AI Chatbot",
        buttons: [
          { reply_id: "choose_package", title: 'Choose Package', next_node_key: 'choose_package_reply' },
          { reply_id: "about_us", title: 'About Us', next_node_key: 'about_us_reply' },
          { reply_id: "not_interested", title: 'Not interested', next_node_key: 'not_interested_reply' },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "choose_package_reply",
      node_type: "send_message",
      config: {
        text: "Thank you so much for your interest! 🙏✨ Our expert team will connect with you very soon to finalize your package.\n\nExplore our live designs right here: https://nexvora-ud88.onrender.com",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "customize_prompt",
      node_type: "collect_input",
      config: {
        prompt_text: "Thank you for your interest in customizing your website! ✨🚀 To begin setting up your personalized design and features, could you please tell us the exact *Name of your Business*?",
        var_key: "business_name",
        next_node_key: "customize_reply",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "customize_reply",
      node_type: "send_buttons",
      config: {
        text: "Thank you for sharing, *{{vars.business_name}}*! We would love to build and customize your dream website. ✨\n\nHere are our transparent pricing packages tailored for your business:\n\n*💎 Starter - $299*\n*🚀 Growth - $599 (Most Popular)*\n*🛍️ Professional - $999*\n*👑 Enterprise - $1,500+*\n\nPlease select an option below:",
        buttons: [
          { reply_id: "choose_package", title: 'Choose Package', next_node_key: 'choose_package_reply' },
          { reply_id: "about_us", title: 'About Us', next_node_key: 'about_us_reply' },
          { reply_id: "not_interested", title: 'Not interested', next_node_key: 'not_interested_reply' },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "about_us_reply",
      node_type: "send_buttons",
      config: {
        text: "At *Nexvora*, founded by *Prince R Pandey*, we are an elite digital design and web engineering agency with *2+ years of experience* and over *20+ premium projects* delivered globally. ✨🚀\n\nWhat would you like to explore next?",
        buttons: [
          { reply_id: "pricing", title: 'Get Pricing', next_node_key: 'price_reveal' },
          { reply_id: "customize", title: 'Customize Mine', next_node_key: 'customize_prompt' },
          { reply_id: "not_interested", title: 'Not interested', next_node_key: 'not_interested_reply' },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "not_interested_reply",
      node_type: "send_message",
      config: {
        text: "Thank you so much for your honest feedback! 🙏\n\nWe are constantly working to improve our services and designs. We will always be right here whenever you need us in the future for any website or digital solutions.\n\nWishing you and your business immense success and growth ahead! 😊🌟",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
    },
  ],
};

// ============================================================
// Registry
// ============================================================

const TEMPLATES: Record<string, FlowTemplate> = {
  welcome_menu: WELCOME_MENU,
  faq_bot: FAQ_BOT,
  lead_capture: LEAD_CAPTURE,
  nexvora_outreach: NEXVORA_OUTREACH,
};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}
