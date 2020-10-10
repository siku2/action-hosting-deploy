/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { exec } from "@actions/exec";

export type SiteDeploy = {
  site: string;
  target: string | undefined;
  url: string;
  expireTime: string;
};

export type ErrorResult = {
  status: "error";
  error: string;
};

export type ChannelSuccessResult = {
  status: "success";
  result: { [key: string]: SiteDeploy };
};

export type ProductionSuccessResult = {
  status: "success";
  result: {
    hosting: string;
  };
};

export type DeployAuth = {
  gacFilename?: string;
  firebaseToken?: string;
};

function authToEnv(auth: DeployAuth): { [key: string]: string } {
  const env = {};
  if (auth.gacFilename) {
    env["GOOGLE_APPLICATION_CREDENTIALS"] = auth.gacFilename;
  } else if (auth.firebaseToken) {
    env["FIREBASE_TOKEN"] = auth.firebaseToken;
  }

  return env;
}

export type DeployConfig = {
  auth: DeployAuth;
  projectId: string;
  expires: string;
  channelId: string;
  targets: string[];
};

async function execWithCredentials(
  firebase,
  args: string[],
  projectId,
  auth: DeployAuth,
  debug: boolean = false
) {
  let deployOutputBuf: Buffer[] = [];
  try {
    await exec(
      firebase,
      [
        ...args,
        ...(projectId ? ["--project", projectId] : []),
        debug
          ? "--debug" // gives a more thorough error message
          : "--json", // allows us to easily parse the output
      ],
      {
        listeners: {
          stdout(data: Buffer) {
            deployOutputBuf.push(data);
          },
        },
        env: {
          ...process.env,
          FIREBASE_DEPLOY_AGENT: "action-hosting-deploy",
          ...authToEnv(auth),
        },
      }
    );
  } catch (e) {
    console.log(Buffer.concat(deployOutputBuf).toString("utf-8"));
    console.log(e.message);

    if (debug === false) {
      console.log(
        "Retrying deploy with the --debug flag for better error output"
      );
      return execWithCredentials(firebase, args, projectId, auth, true);
    } else {
      throw e;
    }
  }

  return deployOutputBuf.length
    ? deployOutputBuf[deployOutputBuf.length - 1].toString("utf-8")
    : ""; // output from the CLI
}

export async function deploy(deployConfig: DeployConfig) {
  const { auth, projectId, expires, channelId, targets } = deployConfig;

  const deploymentText = await execWithCredentials(
    "npx firebase-tools",
    [
      "hosting:channel:deploy",
      ...(targets.length > 0 ? ["--only", targets.join(",")] : []),
      channelId,
      ...(expires ? ["--expires", expires] : []),
    ],
    projectId,
    auth
  );

  const deploymentResult = JSON.parse(deploymentText) as
    | ChannelSuccessResult
    | ErrorResult;

  return deploymentResult;
}

export async function deployProductionSite(
  auth: DeployAuth,
  projectId: string,
  targets: string[]
) {
  let targetArg: string;
  if (targets.length > 0) {
    targetArg = targets.map((target) => `hosting:${target}`).join(",");
  } else {
    targetArg = "hosting";
  }

  const deploymentText = await execWithCredentials(
    "npx firebase-tools",
    ["deploy", "--only", targetArg],
    projectId,
    auth
  );

  const deploymentResult = JSON.parse(deploymentText) as
    | ProductionSuccessResult
    | ErrorResult;

  return deploymentResult;
}
