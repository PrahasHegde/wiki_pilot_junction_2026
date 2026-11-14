FROM mariadb:lts
# MariaDB S3 storage engine: archived (read-only) tables live in an S3 bucket and stay queryable
RUN apt-get update && apt-get install -y --no-install-recommends mariadb-plugin-s3 && rm -rf /var/lib/apt/lists/*
