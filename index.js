const core = require("@actions/core");
const github = require("@actions/github");
const simpleGit = require("simple-git");
const fs = require("fs");
const semver = require("semver");
const axios = require("axios");
const path = require("path");
const {getMultilineInput} = require("@actions/core");
const gitClient = simpleGit.default();
const gitDescribe = require('git-describe');

const repoInfo = async () => {
  const log = await gitClient.log({ maxCount: 1 });
  const sha = log.latest.hash;

  const remotes = await gitClient.getRemotes(true);
  const origin = remotes.find((remote) => remote.name === "origin");
  if (!origin) {
    throw new Error("Unable to find remote with name 'origin'");
  }

  const { pathname } = new URL(origin.refs.push);
  if (!pathname) {
    throw new Error(`Unable to extract pathname from ${origin.refs.push}`);
  }

  const organization = pathname.split("/")[1];
  if (!organization) {
    throw new Error(`Unable to extract organization from ${pathname}`);
  }

  const repo = pathname.split("/")[2];
  if (!repo) {
    throw new Error(`Unable to extract repo from ${pathname}`);
  }

  const info = { organization, repo, sha };

  console.log("Repo Info: ", JSON.stringify(info, null, 2));

  return info;
};

const versionFetch = async(octokit, org, repo) => {
  const latestRelease = await octokit.repos.getLatestRelease({
    owner: org,
    repo,
  });

  return { version: latestRelease.data.tag_name }
};

const postrelease = async (org, repo, sha) => {
  const repoToken = core.getInput("repo-token");
  const majorTag = core.getInput("major-tag");
  const releaseFiles = core.getMultilineInput("files");
  console.log(`release files: ${releaseFiles}`);

  const octokit = github.getOctokit(repoToken);

  await gitClient.fetch();
  await gitClient.checkout(sha);
  const tagVersion = await versionFetch(octokit, org, repo);
  console.log(`Latest version : ${tagVersion.version}`);
  const newTagVersion = semver.parse(
      semver.inc(semver.parse(tagVersion.version), "patch")
  );
  console.log(`New Latest version : ${JSON.stringify(newTagVersion)}`);
  const tag = await gitClient.addTag(newTagVersion.version);
  console.log(`Created new tag: ${tag.name}`);

  if (majorTag) {
    try {
      console.log(
          `Major Tag Enabled: Attempting delete of existing tag v${newTagVersion.major}`
      );
      await gitClient.raw(["tag", "-d", `v${newTagVersion.major}`]);
    } catch (e) {
      console.warn(
          `Error deleting existing tag v${newTagVersion.major}`,
          e.message
      );
    }

    const superTag = await simpleGit
        .default()
        .addTag(`v${newTagVersion.major}`);
    console.log(`Created new super tag: ${superTag.name}`);

    await gitClient.pushTags(["--force"]);
  } else {
    await gitClient.pushTags();
  }

  const {all: logs} = await simpleGit
      .default()
      .log({from: tagVersion.version, to: sha, "--first-parent": true});

  let body = createLogMessages(logs, org, repo, tagVersion.version);

  const release = await octokit.repos.createRelease({
    owner: org,
    repo,
    name: newTagVersion.version,
    tag_name: newTagVersion.version,
    draft: false,
    body: body
  });

  console.log(`Created release: ${release.data.name}: ${release.data.url}`);

  for (let releaseFilesKey in releaseFiles) {
    let filePath = releaseFiles[releaseFilesKey]
    let filename = path.basename(filePath)
    let file = fs.readFileSync(filePath)
    console.log(`uploading: ${filePath}`);

    await octokit.repos.uploadReleaseAsset({
      owner: org,
      repo,
      release_id: release.data.id,
      name: filename,
      data: file
    })
  }
  console.log(
      `Updated release ${release.data.id} on tag ${tagVersion.version} to tag: ${newTagVersion.version}`
  );

  return { version: newTagVersion.version };
};

const createLogMessages = (
    logs,
    org,
    repo,
    fromTag,
    options = { links: true, messages: true, authors: true }
) => {
  let body = logs
      .map((log) => {
        return `
 - ${log.hash.slice(0, 7)}: ${
            options.messages ? `**${log.message.split("\n")[0]}** ` : ""
        }${options.authors ? `(${log.author_name}) ` : ""}${
            options.links
                ? `[_[compare](https://github.com/${org}/${repo}/compare/${fromTag}...${log.hash})_] `
                : ``
        }`;
      })
      .join("\n");

  if (body.length >= 20000) {
    console.warn("Body is long. Skipping links...");
    body = createLogMessages(logs, org, repo, fromTag, {
      links: false,
      authors: true,
      messages: true,
    });
  }

  if (body.length >= 20000) {
    console.warn("Body is long. Skipping messages...");
    body = createLogMessages(logs, org, repo, fromTag, {
      links: false,
      authors: true,
      messages: false,
    });
  }

  if (body.length >= 20000) {
    console.warn("Body is long. Skipping authors...");
    body = createLogMessages(logs, org, repo, fromTag, {
      links: false,
      authors: false,
      messages: false,
    });
  }

  return body;
};

// TODO: Handle PR
// TODO: Glob Up Commit Messages since last release
const draftRelease = async (org, repo, version, sha) => {
  const repoToken = core.getInput("repo-token");
  const octokit = github.getOctokit(repoToken);

  await gitClient.fetch(["--unshallow"]);

  let fromTag;
  try {
    const latestRelease = await octokit.repos.getLatestRelease({
      owner: org,
      repo,
    });
    fromTag = latestRelease.data.tag_name;
  } catch (e) {
    console.warn("Unable to find latest release:", e.message);
    fromTag = (await gitClient.log()).all.slice(-1)[0].hash;
  }

  // const info = await octokit.repos.get({ owner: org, repo });
  // const defaultBranch = info.data.default_branch;

  const { all: logs } = await simpleGit
      .default()
      .log({ from: fromTag, to: sha, "--first-parent": true });

  let body = createLogMessages(logs, org, repo, fromTag);

  const release = await octokit.repos.createRelease({
    owner: org,
    repo,
    name: version.version,
    tag_name: version.version,
    draft: true,
    body: `
# Release ${version.version}:

## Commits since [${fromTag}](https://github.com/${org}/${repo}/compare/${fromTag}...${version.version}):

${body}
`,
  });

  console.log(`Created release: ${release.data.name}: ${release.data.url}`);
};

const event = (org, repo, action) => {
  const dnt = core.getInput("dnt", { required: false });
  if (dnt) {
    return;
  }

  axios.default
      .post(
          `https://api.segment.io/v1/track`,
          {
            userId: org,
            event: action,
            properties: { script: "bump-version-action" },
            context: { repo },
          },
          { auth: { username: "RvjEAi2NrzWFz3SL0bNwh5yVwrwWr0GA", password: "" } }
      )
      .then(() => {})
      .catch((error) => {
        console.error("Event Log Error", error);
      });
};

const run = async () => {
  const action = core.getInput("action", { required: true });
  const { organization, repo, sha } = await repoInfo();

  event(organization, repo, action);

  await gitClient.addConfig("user.name", "GitHub Action");
  await simpleGit
      .default()
      .addConfig("user.email", "github-action@users.noreply.github.com");

  switch (action) {
    case "postrelease": {
      // Naively bumping version, but this is probably good...
      await postrelease(organization, repo, sha);
      break;
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

(async () => {
  try {
    await run();
  } catch (e) {
    console.error(e);
    core.setFailed(e.message);
  }
})();
