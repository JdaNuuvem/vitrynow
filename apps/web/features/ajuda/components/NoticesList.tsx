"use client";

import { useState } from "react";
import type { Notice } from "@/core/domain/notices";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

type NoticesListProps = {
  notices: Notice[];
  onRead: (noticeId: string) => void;
};

export function NoticesList({ notices, onRead }: NoticesListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (notices.length === 0) {
    return (
      <>
        <p className="help-widget__muted">Sem avisos recentes</p>
        <p className="help-widget__muted">Por hoje é só :)</p>
      </>
    );
  }

  function toggle(notice: Notice) {
    setExpandedId((current) => (current === notice.id ? null : notice.id));
    if (!notice.read) onRead(notice.id);
  }

  return (
    <ul className="help-notices">
      {notices.map((notice) => {
        const expanded = expandedId === notice.id;
        return (
          <li key={notice.id} className={`help-notices__item${notice.read ? "" : " is-unread"}${expanded ? " is-expanded" : ""}`}>
            <button type="button" onClick={() => toggle(notice)} aria-expanded={expanded}>
              <span className="help-notices__title">{notice.title}</span>
              <span className="help-notices__date">{formatDate(notice.publishedAt)}</span>
            </button>
            {expanded && (
              <div className="help-notices__body">
                <p>{notice.body}</p>
                {notice.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={notice.imageUrl} alt="" />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
