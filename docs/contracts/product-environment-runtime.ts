import type {
  ProductClaimToken,
  ProductDispatchTargetBinding,
} from "./product-auto-deploy";
import type {
  ProductEnvironmentReference,
  ProductEnvironmentValues,
} from "./product-environment";

/** Internal trusted controller only; never IPC/result/journal or raw JSON capability. */
export interface ResolvedProductEnvironment {
  claim: ProductClaimToken;
  target: ProductDispatchTargetBinding;
  reference: ProductEnvironmentReference;
  framework: "express" | "static-spa" | "nextjs";
  values: ProductEnvironmentValues;
  /** Chỉ trusted controller, key không nằm trong DTO/argv/env; purpose-separated HMAC. */
  signRuntime: (payload: string) => string;
}
export const PRODUCT_ENVIRONMENT_HEADER = "# opspilot-environment-v1 ";
export const PRODUCT_ENVIRONMENT_MARKER = "OPSPILOT_CONFIG_REVISION";
export const PRODUCT_ENVIRONMENT_SIGNATURE = "# opspilot-environment-hmac ";
/** Header UTF8 JSON: exact keys {format:1,claim,target,reference,nonce,runtime_keys}.
 * claim includes complete claim token; target/reference must match current H2 context.
 * nonce is private random 32 bytes lowercase hex, never source/SQLite/log/receipt.
 * Second line signature prefix + lowercase hex HMAC; payload is first line + LF +
 * remaining body (excluding signature line). Key=HMAC(app-generation runtime key,
 * "opspilot-env-transfer-key-v1"), signature purpose="opspilot-env-transfer-v1\\n".
 * Remaining lines KEY=literal_value, LF only. One derived system marker, user keys
 * as vault policy; no control chars, empty values kept, no dotenv/shell interpolation.
 * File0600; max96KiB; hash/manifest only ephemeral SSH/private target scope marker.
 * Env-enabled source-render result must omit its manifest digest (null).
 * Runtime code/receipt/error must not contain value, file text, raw Docker inspect
 * or unkeyed hash of secret-containing Config.Env. Marked containers use existing
 * app-generation key with HMAC-SHA256 and distinct purpose for config fingerprint.
 * Unmarked containers retain old fingerprint for previous deployment compatibility.
 */
