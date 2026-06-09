"use client";

import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function login() {
    setIsLoading(true);
    setError("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      setError("Invalid login details.");
      setIsLoading(false);
      return;
    }

    window.location.href = "/";
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <LockKeyhole className="h-5 w-5" aria-hidden="true" />
          </div>
          <CardTitle>Secure Dashboard Login</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Login ID"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            type="password"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="button" className="w-full" onClick={login} disabled={isLoading}>
            {isLoading ? "Signing in" : "Sign In"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
