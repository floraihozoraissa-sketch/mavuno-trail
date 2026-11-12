export {};

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        farmerId?: string;
        cooperativeId: string;
        role: "manager" | "staff" | "farmer";
        walletAddress?: string;
      };
    }
    
  }
}