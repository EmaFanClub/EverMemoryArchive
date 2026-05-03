export interface OwnerStatusResponse {
  apiVersion: "v1beta1";
  ownerReady: boolean;
  user?: {
    id: string;
    name: string;
  };
}
