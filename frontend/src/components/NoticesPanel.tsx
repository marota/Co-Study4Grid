// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React, { useEffect, useRef, useState } from 'react';
import { colors, radius, space, text } from '../styles/tokens';

export interface Notice {
  /** Stable id used as React key and for dismiss tracking. */
  id: string;
  /** One-line title shown bold on the notice card. */
  title: string;
  /**
   * Body content. ReactNode so callers can compose icons / inline buttons /
   * styled fragments. Rendered with the warning-text color on a soft yellow
   * background for visual continuity with the previous inline banners.
   */
  body: React.ReactNode;
  /**
   * Visual severity. `info` renders blue, `warning` renders yellow.
   * Both share the same panel layout so the operator can scan all
   * active notices at once.
   */
  severity?: 'info' | 'warning';
  /** Optional dismiss handler — when set, a × appears on the card. */
  onDismiss?: () => void;
  /** Optional in-card action button (e.g. "Open settings"). */
  action?: { label: string; onClick: () => void };
}

interface NoticesPanelProps {
  notices: Notice[];
}

/**
 * Sidebar-header pill that opens an inline panel listing every active
 * background notice (action-dict info, recommender thresholds,
 * monitoring coverage). Replaces the five concurrent yellow banners
 * called out in `docs/proposals/ui-design-critique.md` recommendation
 * #4 — one entry point, one place to dismiss, no warning-fatigue
 * stack.
 *
 * The pill self-hides when there are zero active notices so the
 * sidebar header stays clean once the operator has dismissed
 * everything they wanted to dismiss.
 */
export default function NoticesPanel({ notices }: NoticesPanelProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close-on-outside-click — keeps the panel modal-light without
  // requiring a backdrop layer that would compete with the rest of
  // the chrome.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // When the underlying state retires every notice (e.g. operator
  // hits Dismiss on the last one) we early-return below so the pill
  // and the open panel both unmount. The `open` state is intentionally
  // not reset here — when fresh notices arrive on a later render the
  // panel will be re-mounted in its default collapsed state because
  // useState defaults run per-mount.
  if (notices.length === 0) return null;

  return (
    <div
      ref={containerRef}
      data-testid="notices-panel"
      style={{ position: 'relative', flexShrink: 0 }}
    >
      <button
        type="button"
        data-testid="notices-pill"
        onClick={() => setOpen(prev => !prev)}
        title={`${notices.length} active notice${notices.length === 1 ? '' : 's'}`}
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: space[1],
          padding: `3px ${space[2]}`,
          border: `1px solid ${colors.warningBorder}`,
          background: colors.warningSoft,
          color: colors.warningText,
          borderRadius: radius.lg,
          fontSize: text.xs,
          fontWeight: 600,
          cursor: 'pointer',
          lineHeight: 1.4,
        }}
      >
        <span aria-hidden="true">⚠️</span>
        Notices
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '18px',
            height: '18px',
            padding: `0 ${space[1]}`,
            background: colors.warning,
            color: colors.textPrimary,
            borderRadius: '999px',
            fontSize: text.xs,
            fontWeight: 700,
          }}
        >
          {notices.length}
        </span>
      </button>

      {open && (
        <div
          data-testid="notices-list"
          role="dialog"
          aria-label="Active notices"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 'auto',
            zIndex: 50,
            width: '320px',
            maxHeight: '60vh',
            overflowY: 'auto',
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.md,
            boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
            padding: space[2],
            display: 'flex',
            flexDirection: 'column',
            gap: space[2],
          }}
        >
          {notices.map(notice => {
            const isInfo = notice.severity === 'info';
            return (
              <div
                key={notice.id}
                data-testid={`notice-${notice.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: space[2],
                  padding: `${space[2]} ${space[3]}`,
                  background: isInfo ? colors.infoSoft : colors.warningSoft,
                  border: `1px solid ${isInfo ? colors.infoBorder : colors.warningBorder}`,
                  borderRadius: radius.sm,
                  fontSize: text.sm,
                  color: isInfo ? colors.infoText : colors.warningText,
                  lineHeight: 1.45,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, marginBottom: space[1] }}>{notice.title}</div>
                  <div>{notice.body}</div>
                  {notice.action && (
                    <button
                      type="button"
                      onClick={notice.action.onClick}
                      style={{
                        marginTop: space[1],
                        background: 'none',
                        border: 'none',
                        color: colors.brandStrong,
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: text.xs,
                      }}
                    >
                      {notice.action.label}
                    </button>
                  )}
                </div>
                {notice.onDismiss && (
                  <button
                    type="button"
                    onClick={notice.onDismiss}
                    title="Dismiss"
                    aria-label={`Dismiss ${notice.title}`}
                    style={{
                      flexShrink: 0,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: text.lg,
                      lineHeight: 1,
                      color: 'inherit',
                    }}
                  >
                    &times;
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
