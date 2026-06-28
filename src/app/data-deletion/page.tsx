import Link from "next/link";
import { Trash2, ChevronLeft, Calendar, Shield, HelpCircle, Mail, AlertTriangle } from "lucide-react";

export const metadata = {
  title: "Data Deletion Instructions",
  description: "Instructions on how to request deletion of your account and personal data from Nexvora.",
};

export default function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20">
      {/* Background Decorative Gradients */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[10%] top-[5%] h-[400px] w-[400px] rounded-full bg-primary/10 blur-[120px]" />
        <div className="absolute right-[10%] bottom-[10%] h-[350px] w-[350px] rounded-full bg-emerald-500/10 blur-[100px]" />
      </div>

      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="container flex h-16 max-w-4xl items-center justify-between px-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="font-bold tracking-tight">Nexvora</span>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl px-4 py-12 md:py-16">
        <article className="space-y-8">
          {/* Header */}
          <div className="space-y-4 border-b border-border/60 pb-6">
            <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl flex items-center gap-3">
              <Trash2 className="h-10 w-10 text-destructive animate-pulse" />
              Data Deletion Instructions
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                Last Updated: June 28, 2026
              </span>
              <span className="flex items-center gap-1.5">
                <HelpCircle className="h-4 w-4" />
                Meta GDPR / CCPA Compliant
              </span>
            </div>
          </div>

          {/* Intro Card */}
          <div className="rounded-xl border border-border/80 bg-card/50 p-6 backdrop-blur-sm space-y-4">
            <p className="leading-relaxed">
              At <strong>Nexvora</strong>, we value your privacy and are committed to giving you complete control over your personal data. In compliance with the Meta Platform Policies (GDPR / CCPA requirements), you can request the permanent deletion of your account and all associated communication data from our servers at any time.
            </p>
            <div className="flex items-start gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4 text-sm text-yellow-600 dark:text-yellow-500">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              <p>
                <strong>Warning:</strong> Account and data deletion is **permanent** and **irreversible**. Once deleted, all synchronized message history, media files, and active WhatsApp configurations are lost.
              </p>
            </div>
          </div>

          {/* Sections */}
          <div className="space-y-8 leading-relaxed">
            <section className="space-y-4">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                How to Request Data Deletion
              </h2>
              <p>
                To request the deletion of your account and all associated data, follow these simple steps:
              </p>
              
              <div className="relative border-l-2 border-primary/20 pl-6 ml-2 space-y-6 my-4">
                <div className="relative">
                  <div className="absolute -left-[31px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary ring-4 ring-background" />
                  <h3 className="font-bold text-foreground">Step 1: Write an Email</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Send a request email from your registered address to <a href="mailto:arpitaa0325@gmail.com" className="text-primary hover:underline font-medium">arpitaa0325@gmail.com</a>.
                  </p>
                </div>
                
                <div className="relative">
                  <div className="absolute -left-[31px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary ring-4 ring-background" />
                  <h3 className="font-bold text-foreground">Step 2: Provide Account Details</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Include your business name, account identifier, and the specific WhatsApp Phone Number ID linked to the account.
                  </p>
                </div>

                <div className="relative">
                  <div className="absolute -left-[31px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 ring-4 ring-background" />
                  <h3 className="font-bold text-foreground">Step 3: Processing & Confirmation</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Our technical support team will process your request within **24 to 48 hours**. Once all database tables and Supabase storage logs are cleared, you will receive a confirmation email.
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                What Data is Permanently Deleted?
              </h2>
              <p>
                When a data deletion request is processed, the following items are purged from our secure database:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
                <li>Your profile details (Name, Registered Email, Account ID).</li>
                <li>Encrypted Meta API Access Tokens and Phone Number configurations.</li>
                <li>Entire Chat conversation logs and WhatsApp Message records.</li>
                <li>Uploaded media files (images, videos, documents) stored in our Supabase <code className="bg-muted px-1.5 py-0.5 rounded text-xs text-primary">chat-media</code> bucket.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                Contact Technical Support
              </h2>
              <p>
                For immediate assistance or questions regarding our data retention practices, please contact us:
              </p>
              <div className="rounded-lg border border-border p-4 bg-muted/20 flex items-center gap-3">
                <Mail className="h-5 w-5 text-primary shrink-0" />
                <div className="text-sm">
                  <span className="block font-semibold">Email Support:</span>
                  <a href="mailto:arpitaa0325@gmail.com" className="text-primary hover:underline">
                    arpitaa0325@gmail.com
                  </a>
                </div>
              </div>
            </section>
          </div>
        </article>
      </main>

      <footer className="border-t border-border/40 py-8 text-center text-xs text-muted-foreground">
        <div className="container max-w-4xl px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} Nexvora. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
            <Link href="/terms" className="hover:underline">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
