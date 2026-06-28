import Link from "next/link";
import { Shield, ChevronLeft, Calendar, FileText, ArrowRight } from "lucide-react";

export const metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for Nexvora WhatsApp CRM. Learn how we collect, use, and protect your data.",
};

export default function PrivacyPage() {
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
            <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl">
              Privacy Policy
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                Last Updated: June 28, 2026
              </span>
              <span className="flex items-center gap-1.5">
                <FileText className="h-4 w-4" />
                Version 1.0
              </span>
            </div>
          </div>

          {/* Intro Card */}
          <div className="rounded-xl border border-border/80 bg-card/50 p-6 backdrop-blur-sm">
            <p className="leading-relaxed">
              At <strong>Nexvora</strong>, accessible from{" "}
              <a href="https://crm-2-pi.vercel.app/" className="text-primary hover:underline font-semibold">
                https://crm-2-pi.vercel.app/
              </a>
              , one of our main priorities is the privacy of our visitors and users. This Privacy Policy document contains types of information that is collected and recorded by Nexvora and how we use it, specifically in compliance with the Meta developer policies and WhatsApp Cloud API requirements.
            </p>
          </div>

          {/* Sections */}
          <div className="space-y-8 leading-relaxed">
            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                1. Information We Collect
              </h2>
              <p>
                If you choose to use our Service, we may collect the following types of information:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
                <li>
                  <strong className="text-foreground">Account Information:</strong> Your name, business name, and email address (e.g., <code className="bg-muted px-1.5 py-0.5 rounded text-xs text-primary">arpitaa0325@gmail.com</code>) when you register an account.
                </li>
                <li>
                  <strong className="text-foreground">WhatsApp API Credentials:</strong> Your Phone Number ID, WABA (WhatsApp Business Account) ID, and Graph API Access Tokens, which are encrypted at rest using industry-standard AES-256 encryption.
                </li>
                <li>
                  <strong className="text-foreground">Communication Log Data:</strong> Message history, delivery statuses (sent, delivered, read), and media attachments (such as videos and images) synchronized through the WhatsApp Cloud API.
                </li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                2. How We Use Your Information
              </h2>
              <p>We use the information we collect in various ways, including to:</p>
              <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
                <li>Provide, operate, and maintain our CRM platform.</li>
                <li>Improve, personalize, and expand our CRM services.</li>
                <li>Understand and analyze how you interact with our platform.</li>
                <li>Synchronize communications with your customers via the WhatsApp Cloud API.</li>
                <li>Provide technical support and send system updates.</li>
                <li>Prevent fraud, monitor system health, and ensure security.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                3. Third-Party Services & Meta WhatsApp API
              </h2>
              <p>
                Our CRM connects directly with the WhatsApp Business Platform (provided by Meta Platforms, Inc.). Any messaging data, templates, or media files sent through Nexvora are processed by Meta in accordance with their privacy policies.
              </p>
              <p className="text-muted-foreground">
                We do not sell, trade, or otherwise transfer your data to any other third parties.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                4. Data Security and Retention
              </h2>
              <p>
                We use secure protocols (HTTPS) and encryption technologies (AES-256 for credentials, SSL/TLS for transfers) to protect your account data. Media attachments are stored securely in dedicated Supabase storage buckets.
              </p>
              <p className="text-muted-foreground">
                We retain your information only as long as necessary to provide you with the CRM services or as required by law.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                5. Your Data Protection Rights (GDPR / CCPA)
              </h2>
              <p>You have the right to request access, correction, or deletion of your personal data. Specifically:</p>
              <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
                <li>You can request a copy of your personal data stored in our CRM.</li>
                <li>You can request the deletion of all data associated with your WABA account.</li>
                <li>For instructions on how to request deletion, please visit our <Link href="/data-deletion" className="text-primary hover:underline font-semibold">Data Deletion Instructions page</Link>.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                6. Contact Us
              </h2>
              <p>
                If you have additional questions or require more information about our Privacy Policy, do not hesitate to contact us:
              </p>
              <div className="rounded-lg border border-border p-4 bg-muted/20">
                <p className="text-sm">
                  <strong>Email:</strong>{" "}
                  <a href="mailto:arpitaa0325@gmail.com" className="text-primary hover:underline">
                    arpitaa0325@gmail.com
                  </a>
                </p>
              </div>
            </section>
          </div>
        </article>
      </main>

      <footer className="border-t border-border/40 py-8 text-center text-xs text-muted-foreground">
        <div className="container max-w-4xl px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} Nexvora. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/terms" className="hover:underline">Terms of Service</Link>
            <Link href="/data-deletion" className="hover:underline">Data Deletion</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
