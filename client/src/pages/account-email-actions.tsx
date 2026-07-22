import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle, MailCheck } from "lucide-react";

function useTokenFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") || "";
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">{children}</Card>
    </div>
  );
}

export function VerifyEmailPage() {
  const token = useTokenFromUrl();
  const [status, setStatus] = useState<"working" | "success" | "error">("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("No verification token found in the link.");
      return;
    }
    apiRequest("POST", "/api/auth/verify-email", { token })
      .then(async (res) => {
        const body = await res.json();
        setStatus("success");
        setMessage(body.message || "Email verified successfully");
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      })
      .catch((err: any) => {
        setStatus("error");
        setMessage(err?.message?.replace(/^\d+:\s*/, "") || "Verification failed.");
      });
  }, [token]);

  return (
    <Shell>
      <CardHeader className="text-center">
        <CardTitle data-testid="text-verify-title">Email Verification</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3 text-center">
        {status === "working" && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
        {status === "success" && <CheckCircle2 className="h-8 w-8 text-green-600" />}
        {status === "error" && <XCircle className="h-8 w-8 text-destructive" />}
        <p className="text-sm text-muted-foreground" data-testid="text-verify-message">
          {status === "working" ? "Verifying your email…" : message}
        </p>
      </CardContent>
      <CardFooter className="justify-center">
        <Button asChild variant="outline" data-testid="button-verify-continue">
          <Link href="/auth">Continue to Sign In</Link>
        </Button>
      </CardFooter>
    </Shell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/forgot-password", { email });
      return res.json();
    },
    onSuccess: () => setSent(true),
    onError: (err: any) =>
      toast({ title: "Error", description: err?.message?.replace(/^\d+:\s*/, "") || "Request failed", variant: "destructive" }),
  });

  return (
    <Shell>
      <CardHeader className="text-center">
        <CardTitle data-testid="text-forgot-title">Forgot Password</CardTitle>
        <CardDescription>Enter your email and we'll send you a reset link.</CardDescription>
      </CardHeader>
      {sent ? (
        <CardContent className="flex flex-col items-center gap-3 text-center">
          <MailCheck className="h-8 w-8 text-green-600" />
          <p className="text-sm text-muted-foreground" data-testid="text-forgot-sent">
            If that email is registered, a reset link has been sent. Check your inbox.
          </p>
        </CardContent>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                data-testid="input-forgot-email"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={mutation.isPending} data-testid="button-send-reset">
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send Reset Link
            </Button>
            <Button asChild variant="ghost" className="w-full" data-testid="link-back-to-signin">
              <Link href="/auth">Back to Sign In</Link>
            </Button>
          </CardFooter>
        </form>
      )}
    </Shell>
  );
}

export function ResetPasswordPage() {
  const token = useTokenFromUrl();
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/reset-password", { token, newPassword });
      return res.json();
    },
    onSuccess: () => {
      setDone(true);
      toast({ title: "Password reset", description: "You can now sign in with your new password." });
      setTimeout(() => setLocation("/auth"), 1500);
    },
    onError: (err: any) =>
      toast({ title: "Error", description: err?.message?.replace(/^\d+:\s*/, "") || "Reset failed", variant: "destructive" }),
  });

  return (
    <Shell>
      <CardHeader className="text-center">
        <CardTitle data-testid="text-reset-title">Reset Password</CardTitle>
        <CardDescription>Choose a new password for your account.</CardDescription>
      </CardHeader>
      {done ? (
        <CardContent className="flex flex-col items-center gap-3 text-center">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
          <p className="text-sm text-muted-foreground" data-testid="text-reset-done">
            Password reset successfully. Redirecting to sign in…
          </p>
        </CardContent>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!token) {
              toast({ title: "Invalid link", description: "No reset token found in the link.", variant: "destructive" });
              return;
            }
            if (newPassword !== confirm) {
              toast({ title: "Passwords don't match", description: "Please re-enter your new password.", variant: "destructive" });
              return;
            }
            mutation.mutate();
          }}
        >
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat your new password"
                data-testid="input-confirm-password"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={mutation.isPending} data-testid="button-reset-password">
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reset Password
            </Button>
            <Button asChild variant="ghost" className="w-full" data-testid="link-reset-back">
              <Link href="/auth">Back to Sign In</Link>
            </Button>
          </CardFooter>
        </form>
      )}
    </Shell>
  );
}
