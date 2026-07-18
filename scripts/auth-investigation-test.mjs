import { createClerkClient } from "@clerk/backend";
import dotenv from "dotenv";

dotenv.config();

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
});

const users = await clerk.users.getUserList({ limit: 1 });
if (!users.data.length) {
  console.log("NO_USERS - trying testing token path");
  const testing = await clerk.testingTokens.createTestingToken();
  const jwt = testing.token;
  console.log("testing_token_present", Boolean(jwt));

  const res = await fetch("http://localhost:3004/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      "x-forwarded-host": "localhost:3000",
      "x-forwarded-proto": "http",
    },
    body: JSON.stringify({ query: "query { __typename }" }),
  });

  console.log("status", res.status);
  console.log("body", await res.text());
  process.exit(0);
}

const userId = users.data[0].id;
console.log("user", userId);

const sessions = await clerk.sessions.getSessionList({
  userId,
  status: "active",
  limit: 1,
});

let sessionId;
if (sessions.data.length) {
  sessionId = sessions.data[0].id;
} else {
  const session = await clerk.sessions.createSession({ userId });
  sessionId = session.id;
}
console.log("session", sessionId);

const token = await clerk.sessions.getToken(sessionId, "default");
console.log("token_present", Boolean(token?.jwt));

const res = await fetch("http://localhost:3004/graphql", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token.jwt}`,
    "x-forwarded-host": "localhost:3000",
    "x-forwarded-proto": "http",
  },
  body: JSON.stringify({ query: "query { __typename }" }),
});

console.log("status", res.status);
console.log("body", await res.text());
