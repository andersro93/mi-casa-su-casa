export type AuthContext = {
  user: {
    id: string;
    email: string;
    role: string;
  } | null;
  session: {
    id: string;
    userId: string;
  } | null;
};
