export type AuthContext = {
  user: {
    id: string;
    email: string;
    role: string;
    households: Array<{
      id: string;
      slug: string;
      displayName: string;
      role: "owner" | "member";
    }>;
  } | null;
  session: {
    id: string;
    userId: string;
  } | null;
  household: {
    id: string;
    slug: string;
    role: "owner" | "member";
  } | null;
};
