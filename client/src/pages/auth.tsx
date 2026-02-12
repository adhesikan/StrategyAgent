import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import logoUrl from "@assets/ChatGPT_Image_Jan_1,_2026,_01_38_07_PM_1767292703801.png";

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [acceptLegal, setAcceptLegal] = useState(false);
  const { login, register, isLoggingIn, isRegistering } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isLogin && !acceptLegal) {
      toast({ title: "Required", description: "Please accept the legal agreements to continue.", variant: "destructive" });
      return;
    }
    
    try {
      if (isLogin) {
        await login({ email, password });
        toast({ title: "Welcome back!", description: "You have been logged in successfully." });
      } else {
        await register({ email, password, firstName, lastName, acceptLegal: true });
        toast({ title: "Account created!", description: "Your account has been created successfully." });
      }
      setLocation("/");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : (isLogin ? "Failed to login" : "Failed to register");
      toast({ title: "Error", description: message, variant: "destructive" });
    }
  };

  const isSubmitting = isLoggingIn || isRegistering;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center mb-4">
            <img src={logoUrl} alt="VCP Trader" className="h-10 w-auto" />
          </div>
          <CardTitle data-testid="text-auth-title">{isLogin ? "Sign In" : "Create Account"}</CardTitle>
          <CardDescription>
            {isLogin 
              ? "Enter your credentials to access trade signals" 
              : "Sign up to start receiving trade signals"}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {!isLogin && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    data-testid="input-first-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="John"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    data-testid="input-last-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                data-testid="input-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                data-testid="input-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                minLength={6}
              />
            </div>
            {!isLogin && (
              <div className="flex items-start gap-3 pt-2">
                <Checkbox
                  id="acceptLegal"
                  checked={acceptLegal}
                  onCheckedChange={(checked) => setAcceptLegal(checked === true)}
                  data-testid="checkbox-accept-legal"
                />
                <Label htmlFor="acceptLegal" className="text-sm leading-relaxed cursor-pointer">
                  I agree to the{" "}
                  <Link href="/terms" className="text-primary underline" data-testid="link-signup-terms">Terms of Use</Link>
                  ,{" "}
                  <Link href="/disclaimer" className="text-primary underline" data-testid="link-signup-disclaimer">Disclaimer</Link>
                  , and{" "}
                  <Link href="/privacy" className="text-primary underline" data-testid="link-signup-privacy">Privacy Policy</Link>
                </Label>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button 
              type="submit" 
              className="w-full" 
              disabled={isSubmitting}
              data-testid="button-submit-auth"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLogin ? "Sign In" : "Create Account"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setIsLogin(!isLogin);
                setAcceptLegal(false);
              }}
              data-testid="button-toggle-auth-mode"
            >
              {isLogin ? "Need an account? Sign up" : "Already have an account? Sign in"}
            </Button>
            <div className="flex justify-center gap-4 text-xs text-muted-foreground">
              <Link href="/terms" className="hover:text-foreground" data-testid="link-auth-terms">Terms</Link>
              <Link href="/disclaimer" className="hover:text-foreground" data-testid="link-auth-disclaimer">Disclaimer</Link>
              <Link href="/privacy" className="hover:text-foreground" data-testid="link-auth-privacy">Privacy</Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
