/**
 * Roles API endpoint.
 * See https://nextjs.org/blog/building-apis-with-nextjs#32-multiple-http-methods-in-one-file
 */

import { getServer } from "../shared-server";

/**
 * GET /api/roles - Get a specific role
 * Query params:
 *   - id: Role ID to fetch a specific role
 */
export async function GET(request: Request) {
  try {
    const server = await getServer();
    const url = new URL(request.url);
    const rawRoleId = url.searchParams.get("id");
    const roleId = Number.parseInt(rawRoleId ?? "");

    if (rawRoleId == null || Number.isNaN(roleId)) {
      return new Response(
        JSON.stringify({
          error:
            "A valid role id is required as a query parameter (?id=<number>)",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    // Get specific role
    const role = await server.getRole(roleId);
    if (!role) {
      return new Response(
        JSON.stringify({
          error: "Role not found",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return new Response(JSON.stringify(role), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Failed to process GET request",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

/**
 * POST /api/roles - Create a new role
 * Body: RoleData (id optional; an id will be generated if not provided)
 */
export async function POST(request: Request) {
  try {
    const server = await getServer();
    const body = await request.json();
    if (!body.name || !body.description || !body.prompt) {
      return new Response(
        JSON.stringify({
          error: "name, description, and prompt are required",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const id = await server.upsertRole(body);

    return new Response(
      JSON.stringify({
        message: "Role created successfully",
        id,
      }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to create role",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

/**
 * PUT /api/roles - Update an existing role
 * Body: RoleData (with id)
 */
export async function PUT(request: Request) {
  try {
    const server = await getServer();
    const body = await request.json();
    if (!body.name || !body.description || !body.prompt) {
      return new Response(
        JSON.stringify({
          error: "name, description, and prompt are required",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Validate required fields
    if (!body.id) {
      return new Response(
        JSON.stringify({
          error: "Role id is required",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Check if role exists
    const existingRole = await server.getRole(body.id);
    if (!existingRole) {
      return new Response(
        JSON.stringify({
          error: "Role not found",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const id = await server.upsertRole(body);

    return new Response(
      JSON.stringify({
        message: "Role updated successfully",
        id,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to update role",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

/**
 * DELETE /api/roles - Delete a role (soft delete)
 */
export async function DELETE(request: Request) {
  try {
    const server = await getServer();
    const body = await request.json();
    const roleId = body.id;

    if (!roleId) {
      return new Response(
        JSON.stringify({
          error: "Role id is required",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const deleted = await server.deleteRole(roleId);

    if (!deleted) {
      return new Response(
        JSON.stringify({
          error: "Role not found or already deleted",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        message: "Role deleted successfully",
        id: roleId,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to delete role",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
