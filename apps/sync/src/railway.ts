/**
 * Asking Railway what it has deployed.
 *
 * READ ONLY, on purpose and for now. The button this is for — "put the last
 * good build back", or "ship the one you have been shown" — is an action on
 * production taken from a web page, and the first thing to establish is that
 * the credential works and that we can see what we would be acting on. So this
 * half only looks.
 *
 * IT CANNOT BE RUN ON THIS MACHINE. The token lives in Railway's own variables
 * and nowhere else — that is the point of putting it there — so nothing here
 * executes until it is deployed, and it is verified against production
 * afterwards rather than before. Written accordingly: every failure returns a
 * reason a person can read, because a stack trace from an unrunnable module is
 * no use to anybody.
 *
 * THE TOKEN IS NEVER LOGGED, never returned, and never put in a URL. It goes
 * in one header and nowhere else.
 */
const ENDPOINT = "https://backboard.railway.com/graphql/v2";

export interface RailwayDeployment {
  id: string;
  status: string;
  createdAt: string;
  /** The commit this build came from, when Railway knows it. */
  commit: string | null;
  message: string | null;
}

export interface RailwayView {
  configured: boolean;
  /** Why it cannot answer, in words. Null when it can. */
  problem: string | null;
  service: string | null;
  deployments: RailwayDeployment[];
}

const NOT_CONFIGURED: RailwayView = {
  configured: false,
  problem: "No RAILWAY_API_TOKEN is set on this server, so it cannot ask Railway anything.",
  service: null,
  deployments: [],
};

async function graphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Railway answered ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  if (!body.data) throw new Error("Railway returned no data");
  return body.data;
}

/**
 * The deployments of one service, newest first.
 *
 * `serviceId` and `environmentId` are not secrets — they are in the address bar
 * of the dashboard — but they are still read from the environment rather than
 * written down here, so a second deployment of this app does not quietly act on
 * the first one's production.
 */
export async function recentDeployments(limit = 10): Promise<RailwayView> {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) return NOT_CONFIGURED;
  const serviceId = process.env.RAILWAY_SERVICE_ID;
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
  if (!serviceId || !environmentId) {
    return {
      configured: true,
      problem:
        "RAILWAY_API_TOKEN is set, but RAILWAY_SERVICE_ID and RAILWAY_ENVIRONMENT_ID are not — " +
        "both are in the dashboard's address bar and neither is a secret.",
      service: null,
      deployments: [],
    };
  }
  try {
    const data = await graphql<{
      deployments: { edges: { node: { id: string; status: string; createdAt: string; meta: Record<string, unknown> | null } }[] };
    }>(
      token,
      `query recent($serviceId: String!, $environmentId: String!, $first: Int!) {
         deployments(first: $first, input: { serviceId: $serviceId, environmentId: $environmentId }) {
           edges { node { id status createdAt meta } }
         }
       }`,
      { serviceId, environmentId, first: Math.min(50, Math.max(1, limit)) },
    );
    return {
      configured: true,
      problem: null,
      service: serviceId,
      deployments: data.deployments.edges.map(({ node }) => {
        const meta = (node.meta ?? {}) as { commitHash?: string; commitMessage?: string };
        return {
          id: node.id,
          status: node.status,
          createdAt: node.createdAt,
          commit: meta.commitHash ? meta.commitHash.slice(0, 7) : null,
          message: meta.commitMessage ? meta.commitMessage.split("\n")[0]! : null,
        };
      }),
    };
  } catch (err) {
    // The reason, not a stack: whoever reads this is looking at a dashboard.
    return {
      configured: true,
      problem: err instanceof Error ? err.message : String(err),
      service: serviceId,
      deployments: [],
    };
  }
}
