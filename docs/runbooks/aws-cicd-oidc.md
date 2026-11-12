# Automated AWS CI/CD via GitHub OIDC (Zero Static IAM Keys)

NEXORA deploys to AWS via [`.github/workflows/cd-aws.yml`](../../.github/workflows/cd-aws.yml) using GitHub OIDC federation (`aws-actions/configure-aws-credentials@v4`), Amazon ECR, S3 artifacts, and AWS SSM — matching [`scripts/deploy-aws.sh`](../../scripts/deploy-aws.sh) without storing long-lived AWS keys in GitHub.

## 1. Provision the OIDC Role via CloudFormation

Pass `GitHubRepo` when deploying [`infra/aws/template.yaml`](../../infra/aws/template.yaml):

```bash
aws cloudformation deploy \
  --template-file infra/aws/template.yaml \
  --stack-name nexora-free-tier \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    DBPassword="<your-rds-password>" \
    GitHubRepo="sahil0017/Nexora"
```

> If your AWS account already has an IAM OIDC provider for `token.actions.githubusercontent.com`, also pass `ExistingGitHubOidcProviderArn=arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com`.

Fetch the created role ARN:

```bash
aws cloudformation describe-stacks \
  --stack-name nexora-free-tier \
  --query "Stacks[0].Outputs[?OutputKey=='GitHubDeployRoleArn'].OutputValue" \
  --output text
```

## 2. Configure GitHub Repository Secret & Variables

In GitHub **Settings → Secrets and variables → Actions**:
- **Secret** `AWS_DEPLOY_ROLE_ARN`: the `GitHubDeployRoleArn` output from step 1.
- **Variable** (optional) `AWS_REGION`: defaults to `ap-south-1`.
- **Variable** (optional) `AWS_STACK_NAME`: defaults to `nexora-free-tier`.

## 3. How Smart CD Works

1. Pushes to `main` touching `platform/api/**`, `intelligence/ml-platform/**`, `infra/aws/**`, `infra/postgres/**`, or `scripts/deploy-aws.sh` trigger `cd-aws.yml`.
2. Only changed layers are built/pushed to ECR using GitHub Actions BuildKit layer caching (`nexora/api:<tag>` and/or `nexora/ml:<tag>`).
3. EC2 pulls the prebuilt image(s) via `PREBUILT_IMAGES=1 infra/aws/remote-deploy.sh` over AWS SSM (avoiding `t3.micro` CPU/RAM builds), applies any pending SQL migrations against RDS, restarts only the updated container(s), and verifies `https://<public_ip>.sslip.io/api/v1/healthz`.
4. If `AWS_DEPLOY_ROLE_ARN` is not set yet, the `plan` job safely skips deployment and prints this setup guide instead of failing the workflow.
