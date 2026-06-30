"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Sparkles, RefreshCcw, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function SummariesClient({ initialConversations, initialSummaries, accountId }: { 
  initialConversations: any[]; 
  initialSummaries: any[];
  accountId: string;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [summaries, setSummaries] = useState(initialSummaries);
  const [generating, setGenerating] = useState<string | null>(null);

  const handleGenerateSummary = async (conversationId: string, contactId: string) => {
    setGenerating(conversationId);
    try {
      const response = await fetch('/api/summaries/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, contactId, accountId })
      });
      
      const data = await response.json();
      if (data.success && data.note) {
        // Remove old summary for this contact if exists
        setSummaries(prev => [data.note, ...prev.filter(s => s.contact_id !== contactId)]);
      }
    } catch (error) {
      console.error("Failed to generate summary", error);
    } finally {
      setGenerating(null);
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {conversations.map((conv) => {
        const contactName = conv.contact?.name || conv.contact?.phone || "Unknown";
        // Find the latest summary for this contact
        const summary = summaries.find(s => s.contact_id === conv.contact_id);

        return (
          <Card key={conv.id} className="flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  {contactName}
                </CardTitle>
                <Badge variant={conv.status === 'open' ? 'default' : 'secondary'}>
                  {conv.status}
                </Badge>
              </div>
              <CardDescription>
                Last active: {conv.last_message_at ? format(new Date(conv.last_message_at), 'MMM d, yyyy HH:mm') : 'Never'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-4">
              <div className="flex-1 bg-muted/50 rounded-md p-4 text-sm text-foreground whitespace-pre-wrap">
                {summary ? (
                  summary.note_text.replace('[AI Summary]\n', '')
                ) : (
                  <span className="text-muted-foreground italic">No summary generated yet.</span>
                )}
              </div>
              
              <div className="flex items-center justify-between mt-auto">
                <div className="text-xs text-muted-foreground">
                  {summary && `Updated: ${format(new Date(summary.created_at), 'MMM d, HH:mm')}`}
                </div>
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="gap-2"
                  disabled={generating === conv.id}
                  onClick={() => handleGenerateSummary(conv.id, conv.contact_id)}
                >
                  {generating === conv.id ? (
                    <RefreshCcw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 text-purple-500" />
                  )}
                  {summary ? 'Regenerate' : 'Generate'}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
      
      {conversations.length === 0 && (
        <div className="col-span-full flex flex-col items-center justify-center p-8 text-center border rounded-lg border-dashed">
          <MessageSquare className="h-8 w-8 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No conversations found</h3>
          <p className="text-sm text-muted-foreground">When customers message you, their chats will appear here for summarization.</p>
        </div>
      )}
    </div>
  );
}
