import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SummariesClient } from "./summaries-client";

export default async function SummariesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch the user's active account
  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .single();

  if (!profile || !profile.account_id) {
    redirect("/login");
  }

  // Fetch all conversations with contacts
  const { data: conversations } = await supabase
    .from("conversations")
    .select("*, contact:contacts(*)")
    .eq("account_id", profile.account_id)
    .order("last_message_at", { ascending: false });

  // Fetch all AI Summaries from contact_notes
  const { data: notes } = await supabase
    .from("contact_notes")
    .select("*")
    .eq("account_id", profile.account_id)
    .like("note_text", "[AI Summary]%")
    .order("created_at", { ascending: false });

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">AI Summaries ✨</h2>
          <p className="text-muted-foreground">
            Instantly generate and view chat summaries for all your contacts.
          </p>
        </div>
        <SummariesClient 
          initialConversations={conversations || []} 
          initialSummaries={notes || []}
          accountId={profile.account_id}
        />
      </div>
    </div>
  );
}
