"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction, MessageTemplate } from "@/types";
import { createClient } from "@/lib/supabase/client";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

function MediaUnavailable({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{label} unavailable</span>
    </div>
  );
}

function formatWhatsAppText(text: string | null | undefined) {
  if (!text) return null;
  
  // Split the text by bold markers (* or **)
  // Regex matches **text** or *text*
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <strong key={i} className="font-bold">{part.slice(1, -1)}</strong>;
    }
    return part;
  });
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith("/api/whatsapp/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <img
      src={src ?? ""}
      alt={alt}
      className="max-h-64 max-w-60 rounded-lg object-cover"
      onError={() => setError(true)}
    />
  );
}

function unwrapMediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.includes('proxy-media?url=')) {
    try {
      const urlObj = new URL(url);
      const targetUrl = urlObj.searchParams.get('url');
      if (targetUrl) return targetUrl;
    } catch {
      // Ignore
    }
  }
  return url;
}

function TemplateMessageContent({ message }: { message: Message }) {
  const [template, setTemplate] = useState<MessageTemplate | null>(null);
  
  useEffect(() => {
    if (!message.template_name) return;
    let cancelled = false;
    const fetchTemplate = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("message_templates")
        .select("buttons")
        .eq("name", message.template_name)
        .limit(1)
        .maybeSingle();
      if (!cancelled && data) {
        setTemplate(data as MessageTemplate);
      }
    };
    fetchTemplate();
    return () => { cancelled = true; };
  }, [message.template_name]);

  const mediaUrl = unwrapMediaUrl(message.media_url);
  const isVideoHeader = mediaUrl && (mediaUrl.endsWith(".mp4") || mediaUrl.includes("video") || mediaUrl.includes("/videos/"));
  const isImageHeader = mediaUrl && (mediaUrl.endsWith(".jpg") || mediaUrl.endsWith(".jpeg") || mediaUrl.endsWith(".png") || mediaUrl.includes("image"));

  // Check if this bubble is outbound (agent/bot) so we can style buttons against the primary background
  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  
  return (
    <div className="flex flex-col">
      <span className={cn(
        "mb-2 inline-flex items-center gap-1 self-start rounded px-1.5 py-0.5 text-[10px] font-medium",
        isAgent ? "bg-primary-foreground/10 text-primary-foreground/90" : "bg-primary/10 text-primary"
      )}>
        <LayoutTemplate className="h-3 w-3" />
        Template
      </span>
      {mediaUrl && (
        <div className="mb-2 mt-1">
          {isVideoHeader ? (
            <video src={mediaUrl} controls preload="auto" playsInline className="max-h-64 max-w-60 rounded-lg" />
          ) : isImageHeader ? (
            <MediaImage url={mediaUrl} alt="Template header image" />
          ) : (
            <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="truncate">Header Attachment</span>
            </a>
          )}
        </div>
      )}
      {message.content_text && (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">
          {formatWhatsAppText(message.content_text)}
        </p>
      )}
      {template?.buttons && template.buttons.length > 0 && (
        <div className={cn(
          "mt-2 flex flex-col gap-1.5 pt-2 border-t",
          isAgent ? "border-primary-foreground/20" : "border-primary/20"
        )}>
          {template.buttons.map((btn, i) => (
            <div 
              key={i} 
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors cursor-default",
                isAgent 
                  ? "bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground" 
                  : "bg-muted-foreground/10 hover:bg-muted-foreground/20 text-foreground"
              )}
            >
              <CornerDownLeft className="h-3.5 w-3.5 opacity-70" />
              {btn.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageContent({ message }: { message: Message }) {
  const mediaUrl = unwrapMediaUrl(message.media_url);

  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {formatWhatsAppText(message.content_text)}
        </p>
      );

    case "image":
      return (
        <div>
          {mediaUrl ? (
            <MediaImage url={mediaUrl} alt="Shared image" />
          ) : (
            <MediaUnavailable label="Image" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {formatWhatsAppText(message.content_text)}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {mediaUrl ? (
            <video
              src={mediaUrl}
              controls
              preload="auto"
              playsInline
              className="max-h-64 max-w-60 rounded-lg"
            />
          ) : (
            <MediaUnavailable label="Video" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {formatWhatsAppText(message.content_text)}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {mediaUrl ? (
            <audio src={mediaUrl} controls className="max-w-60" />
          ) : (
            <MediaUnavailable label="Audio" />
          )}
        </div>
      );

    case "document":
      if (!mediaUrl) {
        return <MediaUnavailable label={message.content_text || "Document"} />;
      }
      return (
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {message.content_text || "Document"}
          </span>
        </a>
      );

    case "template":
      return <TemplateMessageContent message={message} />;

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || "Location shared"}</span>
        </div>
      );

    case "interactive": {
      // If it was sent by the bot or an agent, it is an outbound interactive message.
      // We do not show the "Button reply" incoming indicator.
      if (message.sender_type === "bot" || message.sender_type === "agent") {
        return (
          <p className="whitespace-pre-wrap break-words text-sm">
            {formatWhatsAppText(message.content_text || "[Interactive message]")}
          </p>
        );
      }

      // Customer tapped a reply button or list row on a message the bot
      // sent. We show the tapped option's title (already in content_text,
      // set by parseMessageContent in the webhook) with a small affordance
      // so agents reading the inbox can tell at a glance that this is a
      // tap rather than the customer typing the same words.
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <CornerDownLeft className="h-3 w-3" />
            Button reply
          </span>
          <p className="whitespace-pre-wrap break-words text-sm">
            {formatWhatsAppText(message.content_text || "[Interactive reply]")}
          </p>
        </div>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {formatWhatsAppText(message.content_text || "[Unsupported message type]")}
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
}: MessageBubbleProps) {
  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative rounded-2xl px-3 py-2",
          isAgent
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        <MessageContent message={message} />
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          <span
            className={cn(
              "text-[10px]",
              // Outbound bubbles sit on the primary fill, so the
              // timestamp must read against that (not the neutral
              // foreground) — otherwise it goes low-contrast in light
              // mode. Inbound bubbles use the muted surface.
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
