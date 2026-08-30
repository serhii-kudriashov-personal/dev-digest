/* Settings — left sub-nav + sections. API Keys (OpenRouter + GitHub PAT, with
   Test connection), Feature Models, and Git Instances (SPEC-06). Section is
   deep-linked at /settings/:section.

   The sub-nav is the vendored `SETTINGS_SECTIONS` table PLUS this route's own
   `EXTRA_SECTIONS`; the section allowlist is derived from that one merged list
   and never retyped, or a new section would update the URL and leave the pane
   where it was (`client/INSIGHTS.md` 2026-08-16). */
"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState, SETTINGS_SECTIONS } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { SettingsApiKeys } from "./_components/SettingsApiKeys";
import { SettingsModels } from "./_components/SettingsModels";
import { InstancesSection } from "./_components/InstancesSection";
import {
  DEFAULT_SECTION,
  EXTRA_SECTIONS,
  SECTION_API_KEYS,
  SECTION_INSTANCES,
  SECTION_MODELS,
} from "./constants";
import { s } from "./styles";

export function SettingsView() {
  const t = useTranslations("settings");
  const params = useParams<{ section: string }>();
  const section = params.section ?? DEFAULT_SECTION;
  const sections = [
    ...SETTINGS_SECTIONS.map((sec) => ({ key: sec.key as string, label: sec.label as string })),
    ...EXTRA_SECTIONS.map((sec) => ({ key: sec.key as string, label: t(sec.labelKey) })),
  ];
  const current = sections.find((sec) => sec.key === section) ?? sections[0]!;

  return (
    <AppShell crumb={[{ label: t("breadcrumb"), href: "/settings/api-keys" }, { label: current.label }]}>
      <div style={s.layout}>
        <div style={s.nav}>
          <h1 style={s.navTitle}>{t("title")}</h1>
          {sections.map((sec) => {
            const on = sec.key === section;
            return (
              <Link key={sec.key} href={`/settings/${sec.key}`}>
                <div style={s.navItem(on)}>{sec.label}</div>
              </Link>
            );
          })}
        </div>
        <div style={s.pane}>
          {section === SECTION_API_KEYS ? (
            <SettingsApiKeys />
          ) : section === SECTION_MODELS ? (
            <SettingsModels />
          ) : section === SECTION_INSTANCES ? (
            <InstancesSection />
          ) : (
            <EmptyState
              icon="Settings"
              title={current.label}
              body={t("fallbackBody", { label: current.label })}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
