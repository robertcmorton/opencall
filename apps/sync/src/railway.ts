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
  /** Which half of the app this build is — the app is two services. */
  serviceId: string | null;
  serviceName: string | null;
}

export interface RailwayView {
  configured: boolean;
  /** Why it cannot answer, in words. Null when it can. */
  problem: string | null;
  /** This server's own service — the one answering the request. */
  service: string | null;
  /**
   * Whether the list covers the whole environment or only this service.
   * The app is two services and a person asking "what is deployed?" means
   * both, so this being "service" is a degraded answer, not a normal one.
   */
  scope: "environment" | "service";
  deployments: RailwayDeployment[];
}

const NOT_CONFIGURED: RailwayView = {
  configured: false,
  problem: "No RAILWAY_API_TOKEN is set on this server, so it cannot ask Railway anything.",
  service: null,
  scope: "service",
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
 * What has been deployed, newest first.
 *
 * ACROSS THE WHOLE ENVIRONMENT, not just this server. The app is two services
 * — the web app people look at and this sync server — and they deploy
 * separately, so "what is deployed?" has two answers and a reader who is only
 * shown one of them will draw the wrong conclusion. On 29 August exactly that
 * happened: the web app was a day behind while everything else was current,
 * and a badge reading only its own service would have said all was well.
 *
 * `serviceId`, `environmentId` and `projectId` are not secrets — they are in
 * the address bar of the dashboard — and Railway injects all three into every
 * deployment of its own accord, so in practice nothing has to be configured
 * beyond the token. They are still read from the environment rather than
 * written down here, so a second deployment of this app cannot quietly report
 * on the first one's production.
 */
export async function recentDeployments(limit = 10): Promise<RailwayView> {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) return NOT_CONFIGURED;
  const serviceId = process.env.RAILWAY_SERVICE_ID ?? null;
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
  const projectId = process.env.RAILWAY_PROJECT_ID;
  if (!environmentId || (!projectId && !serviceId)) {
    return {
      configured: true,
      problem:
        "RAILWAY_API_TOKEN is set, but RAILWAY_ENVIRONMENT_ID and RAILWAY_PROJECT_ID are not. " +
        "Railway normally injects both into every deployment, so this server is probably not " +
        "running on Railway at all.",
      service: serviceId,
      scope: "service",
      deployments: [],
    };
  }
  const first = Math.min(50, Math.max(1, limit));

  // Whole environment when we can, this service alone when we cannot. The
  // fallback is not decoration: it is the difference between a degraded
  // answer and no answer, and it says which one you got.
  if (projectId) {
    try {
      return {
        configured: true,
        problem: null,
        service: serviceId,
        scope: "environment",
        deployments: await query(token, { projectId, environmentId }, first),
      };
    } catch (err) {
      if (!serviceId) return failed(err, serviceId, "environment");
    }
  }
  try {
    return {
      configured: true,
      problem: null,
      service: serviceId,
      scope: "service",
      deployments: await query(token, { serviceId: serviceId!, environmentId }, first),
    };
  } catch (err) {
    return failed(err, serviceId, "service");
  }
}

async function query(
  token: string,
  input: Record<string, string>,
  first: number,
): Promise<RailwayDeployment[]> {
  const data = await graphql<{
    deployments: {
      edges: {
        node: {
          id: string;
          status: string;
          createdAt: string;
          serviceId?: string | null;
          service?: { name?: string | null } | null;
          meta: Record<string, unknown> | null;
        };
      }[];
    };
  }>(
    token,
    `query recent($input: DeploymentListInput!, $first: Int!) {
       deployments(first: $first, input: $input) {
         edges { node { id status createdAt serviceId service { name } meta } }
       }
     }`,
    { input, first },
  );
  return data.deployments.edges.map(({ node }) => {
    const meta = (node.meta ?? {}) as { commitHash?: string; commitMessage?: string };
    return {
      id: node.id,
      status: node.status,
      createdAt: node.createdAt,
      commit: meta.commitHash ? meta.commitHash.slice(0, 7) : null,
      message: meta.commitMessage ? meta.commitMessage.split("\n")[0]! : null,
      serviceId: node.serviceId ?? null,
      serviceName: node.service?.name ?? null,
    };
  });
}

// The reason, not a stack: whoever reads this is looking at a dashboard.
function failed(err: unknown, service: string | null, scope: "environment" | "service"): RailwayView {
  return {
    configured: true,
    problem: err instanceof Error ? err.message : String(err),
    service,
    scope,
    deployments: [],
  };
}
