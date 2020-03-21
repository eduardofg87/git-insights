const Octokit = require('@octokit/rest').plugin([
  require('./octokit-plugins').getRepoById,
]);

function Github(options) {
  this.options = options;

  const tokens = options.tokens || require('./tokens.json');

  this.type = options.type || 'personal';
  this.tokens = [...tokens];
  this.currentToken = -1;

  this.installationId = options.installationId || -1;
  this.applicationId = options.applicationId || -1;
  this.privateKey = options.privateKey || null;

  this.create();
}

Github.prototype.pickToken = function() {
  if (this.currentToken === this.tokens.length - 1) {
    this.currentToken = 0;
  } else {
    this.currentToken = this.currentToken + 1;
  }

  return this.tokens[this.currentToken];
}

Github.prototype.create = function() {
  if (this.type === 'personal') {
    const token = this.pickToken();
    console.log(`Picked token ${token}`);

    this.options = {
      ...this.options,
      auth: `token ${token}`
    };
  } else {
    /**
     * TODO: cache the id + token combo
     */
    const { createAppAuth } = require("@octokit/auth-app");

    this.options = {
      ...this.options,
      authStrategy: createAppAuth,
      auth: {
        id: this.applicationId,
        privateKey: this.privateKey,
        installationId: this.installationId,
        type: 'installation'
      }
    };
  }

  this.github = new Octokit(this.options);
}

Github.prototype.getRepoDetails = async function(owner, repo) {
  // console.log(`Fetching repo details for ${owner}/${repo}...`);

  try {
    const repoDetails = await this.github.repos.get({
      owner,
      repo
    });
    // console.log(`Fetched repo details!`);
    return repoDetails.data;
  } catch (e) {
    console.log(e);
  }
}

Github.prototype.getRepoDetailsById = async function(id) {
  console.log(`Fetching repo details for ${id}...`);

  try {
    const repoDetails = await this.github.repos.getById({
      id
    });
    console.log(`Fetched repo details!`);
    return repoDetails.data;
  } catch (e) {
    console.log(e);
  }
}

// This function is a bit fragile due to hacks we rely on
// but ¯\_(ツ)_/¯
Github.prototype.getRepoContributorCount = async function(id) {
  try {
    const res = await this.github.repos.listContributorsById({
      id,
      per_page: 1
    });
    // If not 200, means there are no contributors
    if (res.status !== 200) {
      return 0;
    }
    // We need to return 289 from the following string
    // <https://api.github.com/repositories/70908208/contributors?per_page=1&page=2>; rel="next",
    // <https://api.github.com/repositories/70908208/contributors?per_page=1&page=289>; rel="last"
    const re = /=\d+>/gm;
    const matches = res.headers.link.match(re);
    // Remove '=' & '>' characters
    return matches[1].slice(1, -1);
  } catch(e) {
    console.log(e);
    return 0;
  }
}

Github.prototype.getStargazersFromRepo = async function(owner, repo) {
  console.log(`Fetching stargazers for ${owner}/${repo}...`);
  const stargazers = [];
  const per_page = 100;
  let stargazerCount = 0;
  let currentPage = 1;

  try {
    const repoDetails = await this.github.repos.get({
      owner,
      repo
    });
    stargazerCount = repoDetails.data.stargazers_count;

    while ((currentPage - 1) * per_page <= stargazerCount) {
      const pageOfStarGazers = await this.github.activity.listStargazersForRepo({
        owner,
        repo,
        per_page,
        page: currentPage,
        headers: {
          accept: "application/vnd.github.v3.star+json"
        },
      });
      stargazers.push(...pageOfStarGazers.data);
      currentPage++;
    }
    console.log('Fetched all stargazers!');
    return stargazers;
  } catch (e) {
    console.log(e);
  }
}

Github.prototype.getReposStarredByUser = async function(username, cap = 200) {
  const per_page = 100;

  const fetch = async () => {
    try {
      const repos = [];
      let currentPage = 1;

      const options = this.github.activity.listReposStarredByUser.endpoint.merge({
        username,
        per_page
      });

      for await (const response of this.github.paginate.iterator(options)) {
        repos.push(...response.data);

        if (currentPage * per_page >= cap) break;
        currentPage++;
      }

      return repos;
    } catch (err) {
      console.log(err.message);
      this.create();
      let result = await fetch();
      return result;
    }
  }

  let result = await fetch();
  return result;
}

Github.prototype.getUser = async function(userLogin) {
  const fetch = async () => {
    try {
      const response = await this.github.users.getByUsername({ username: userLogin });
      // console.log(`Details fetched for ${username}`);
      return response.data;
      // return Object.assign({}, response.data, { location: user.location });
    } catch (err) {
      if (err.status === 404) {
        console.log(`${username} skipped.`);
        // resolve(null);
        return {};
      }

      console.log(err.message);
      this.create();
      let result = await fetch();
      return result;
    }
  }

  let result = await fetch();
  return result;
}

Github.prototype.listCommitsFromRepo = async function(owner, repo, since) {
  const per_page = 100;

  const fetch = async () => {
    try {
      const commits = [];

      const options = this.github.repos.listCommits.endpoint.merge({
        owner,
        repo,
        since,
        per_page
      });

      for await (const response of this.github.paginate.iterator(options)) {
        commits.push(...response.data);
      }

      return commits;
    } catch (err) {
      if (err.status === 409) {
        if (err.message === "Git Repository is empty.") {
          return [];
        }
      }

      console.log(err.message);
      this.create();
      let result = await fetch();
      return result;
    }
  }

  let result = await fetch();
  return result;
}

Github.prototype.getCommitFromRepo = async function(owner, repo, ref) {
  const fetch = async () => {
    try {
      let commit = await this.github.repos.getCommit({
        owner,
        repo,
        ref
      });
      return commit.data;
    } catch (err) {
      console.log(err.message);
      this.create();
      let result = await fetch();
      return result;
    }
  }

  let result = await fetch();
  return result;
}

Github.prototype.printTopRepos = async function(q) {
  const per_page = 100;
  // const repos = [];

  const options = this.github.search.repos.endpoint.merge({
    q,
    per_page
  });

  for await (const response of this.github.paginate.iterator(options)) {
    repos = [...response.data];
    for (let repo of repos) {
      console.log(`${repo.owner.login}\t${repo.name}\t${repo.stargazers_count}\t${repo.language}`)
    }
  }
}

/**
 * Returns issues of a repo
 *
 * @param {string} since
 *    Only issues updated at or after this time are returned.
 *    This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.
 *
 * @param {string} state
 *    Indicates the state of the issues to return. Can be either open, closed, or all.
 *    Default: open
 */
Github.prototype.listIssuesFromRepo = async function(owner, repo, since, state = "open") {
  const per_page = 100;

  const fetch = async () => {
    try {
      let issues = [];

      const options = this.github.issues.listForRepo.endpoint.merge({
        owner,
        repo,
        since,
        per_page,
        state,
      });

      for await (const response of this.github.paginate.iterator(options)) {
        issues.push(...response.data);
      }

      // Filter out pull requests
      issues = issues.filter(val => !val.pull_request);

      return issues;
    } catch (err) {
      if (err.status === 409) {
        if (err.message === "Git Repository is empty.") {
          return [];
        }
      }

      console.log(err.message);
      this.create();
      let result = await fetch();
      return result;
    }
  }

  let result = await fetch();
  return result;
}

/**
 * Returns pull requests of a repo
 *
 * @param {string} since
 *    Only PRs updated at or after this time are returned.
 *    This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.
 *
 * @param {string} state
 *    Indicates the state of the issues to return. Can be either open, closed, or all.
 *    Default: open
 */
Github.prototype.listPullRequestsFromRepo = async function(owner, repo, since, state = "open") {
  const per_page = 100;

  const fetch = async () => {
    try {
      let issues = [];

      const options = this.github.issues.listForRepo.endpoint.merge({
        owner,
        repo,
        since,
        per_page,
        state,
      });

      for await (const response of this.github.paginate.iterator(options)) {
        issues.push(...response.data);
      }

      // Filter out issues
      issues = issues.filter(val => val.pull_request);

      return issues;
    } catch (err) {
      if (err.status === 409) {
        if (err.message === "Git Repository is empty.") {
          return [];
        }
      }

      console.log(err.message);
      this.create();
      let result = await fetch();
      return result;
    }
  }

  let result = await fetch();
  return result;
}

Github.prototype.listIssueEvents = async function(owner, repo, issue_number) {
  const per_page = 100;

  const fetch = async () => {
    try {
      const issues = [];

      const options = this.github.issues.listEventsForTimeline.endpoint.merge({
        owner,
        repo,
        per_page,
        issue_number,
      });

      for await (const response of this.github.paginate.iterator(options)) {
        issues.push(...response.data);
      }

      return issues;
    } catch (err) {
      if (err.status === 409) {
        if (err.message === "Git Repository is empty.") {
          return [];
        }
      }

      console.log(err.message);
      this.create();
      let result = await fetch();
      return result;
    }
  }

  let result = await fetch();
  return result;
}

Github.prototype.listPullRequestEvents = Github.prototype.listIssueEvents;

Github.prototype.listCommentsForIssue = async function(owner, repo, issue_number) {
  const per_page = 100;

  const fetch = async () => {
    try {
      const issues = [];

      const options = this.github.issues.listComments.endpoint.merge({
        owner,
        repo,
        per_page,
        issue_number,
      });

      for await (const response of this.github.paginate.iterator(options)) {
        issues.push(...response.data);
      }

      return issues;
    } catch (err) {
      if (err.status === 409) {
        if (err.message === "Git Repository is empty.") {
          return [];
        }
      }

      console.log(err.message);
      this.create();
      let result = await fetch();
      return result;
    }
  }

  let result = await fetch();
  return result;
}

module.exports = Github;