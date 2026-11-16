import { actionHeaders } from "../../lib/actions";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: actionHeaders });
}

export function GET() {
  return Response.json(
    {
      rules: [
        { pathPattern: "/pay/*", apiPath: "/api/actions/checkout/*" },
        { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
      ],
    },
    { headers: actionHeaders },
  );
}
