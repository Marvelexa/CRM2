import Link from "next/link";
import { FileText, ChevronLeft, Calendar, Shield, Gavel } from "lucide-react";

export const metadata = {
  title: "Terms of Service",
  description: "Terms of Service for Nexvora WhatsApp CRM. Learn about our service terms and usage policies.",
};

export default function TermsPage() {
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
              Terms of Service
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                Last Updated: June 28, 2026
              </span>
              <span className="flex items-center gap-1.5">
                <Gavel className="h-4 w-4" />
                Version 1.0
              </span>
            </div>
          </div>

          {/* Intro Card */}
          <div className="rounded-xl border border-border/80 bg-card/50 p-6 backdrop-blur-sm">
            <p className="leading-relaxed">
              Welcome to <strong>Nexvora</strong>! These Terms of Service govern your use of the website located at{" "}
              <a href="https://crm-2-pi.vercel.app/" className="text-primary hover:underline font-semibold">
                https://crm-2-pi.vercel.app/
              </a>{" "}
              and the CRM services offered through it. By accessing our Service, you agree to comply with and be bound by these terms.
            </p>
          </div>

          {/* Sections */}
          <div className="space-y-8 leading-relaxed">
            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                1. Acceptance of Terms
              </h2>
              <p>
                By creating an account, connecting your WhatsApp Business credentials, or using any feature of Nexvora, you represent that you are at least 18 years old and agree to these Terms of Service. If you do not agree, please do not use the Service.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                2. Use of WhatsApp Business Platform
              </h2>
              <p>
                Nexvora integrates with the WhatsApp Business Platform via Meta Cloud APIs. By using our integration, you agree to:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
                <li>Comply with Meta&apos;s WhatsApp Business Terms of Service and Developer Policies.</li>
                <li>Avoid using templates or CRM messaging for spamming, harassment, or unauthorized promotional messages.</li>
                <li>Ensure that all recipients have provided necessary opt-in consent to receive your WhatsApp messages.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                3. User Accounts & Security
              </h2>
              <p>
                When you create an account, you must provide accurate info (e.g. contact email <code className="bg-muted px-1.5 py-0.5 rounded text-xs text-primary">arpitaa0325@gmail.com</code>). You are responsible for keeping your login credentials secure. We are not liable for any loss or damage arising from unauthorized access to your account due to poor credential safety.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                4. Prohibited Activities
              </h2>
              <p>You agree not to use the Service to:</p>
              <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
                <li>Send messages containing illegal, harmful, or abusive content.</li>
                <li>Violate local regulations regarding automated business messaging.</li>
                <li>Attempt to bypass security features, reverse-engineer the code, or disrupt server performance.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                5. Limitation of Liability
              </h2>
              <p className="text-muted-foreground">
                Nexvora is provided &quot;as is&quot; and &quot;as available.&quot; We make no warranties that the service will be error-free or uninterrupted. To the maximum extent permitted by law, Nexvora and its developers shall not be liable for any direct, indirect, incidental, or consequential damages resulting from your use or inability to use the Service, including message delivery delays or Meta-level account suspensions.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                6. Modification of Terms
              </h2>
              <p>
                We reserve the right to modify these Terms of Service at any time. We will notify users of major changes by updating the date at the top of this page. Continued use after changes means you accept the revised Terms.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                7. Contact
              </h2>
              <p>
                For questions regarding these Terms of Service, contact support at:
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
            <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
            <Link href="/data-deletion" className="hover:underline">Data Deletion</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
