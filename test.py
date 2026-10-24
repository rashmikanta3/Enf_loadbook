import psycopg2

DATABASE_URL = "postgresql://neondb_owner:npg_Qv6dWsGjiwM9@ep-rapid-surf-aozyrtdl-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("SELECT version();")
    record = cur.fetchone()
    print(" Connection successful!")
    print("PostgreSQL Version:", record[0])
    cur.close()
    conn.close()
except Exception as e:
    print(" Connection failed:")
    print(e)