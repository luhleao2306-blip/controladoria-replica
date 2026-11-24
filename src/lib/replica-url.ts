export const replicaApiUrl = "http://127.0.0.1:55421";

export function assertReplicaUrl(url: string | undefined) {
  if (url !== replicaApiUrl) throw new Error("Inicie a réplica com npm run replica. O banco precisa estar no endereço local da réplica.");
}
