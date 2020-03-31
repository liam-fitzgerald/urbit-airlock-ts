import { request } from "./util";
import qs from "querystring";

/**
 * A description of an authenticated connection to an Urbit
 *
 */
export interface UrbitConnection {
  ship: string;
  cookies: string;
  url: string;
  port: number;
}

/**
 * Authenticate to an Urbit over HTTP.
 * @param ship @p of the running Urbit, without leading sig
 * @param url URL of the running Urbit
 * @param port HTTP Port of the running Urbit
 * @param password +code from the running Urbit
 */
export async function connect(
  ship: string,
  url: string,
  port: number,
  password: string
): Promise<UrbitConnection> {
  const { res } = await request(
    url + "/~/login",
    { method: "post", port },
    qs.stringify({ password })
  );

  if (!res.headers["set-cookie"]) {
    throw new Error("Unable to connect to Urbit");
  }

  const cookies = res.headers["set-cookie"][0] || "";
  return { cookies, ship, url, port };
}
