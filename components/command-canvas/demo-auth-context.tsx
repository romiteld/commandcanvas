"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface DemoAuthenticatedIdentity {
  actorId: string;
  email: string;
}

const DemoAuthenticatedIdentityContext =
  createContext<DemoAuthenticatedIdentity | null>(null);

export function DemoAuthenticatedIdentityProvider({
  identity,
  children,
}: {
  identity: DemoAuthenticatedIdentity | null;
  children: ReactNode;
}) {
  return (
    <DemoAuthenticatedIdentityContext.Provider value={identity}>
      {children}
    </DemoAuthenticatedIdentityContext.Provider>
  );
}

export function useDemoAuthenticatedIdentity() {
  return useContext(DemoAuthenticatedIdentityContext);
}
