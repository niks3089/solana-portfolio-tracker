#!/bin/bash
# Sanity tests for Portfolio Dashboard
# Usage: ./sanity-test.sh <base_url>
# Example: ./sanity-test.sh http://45.76.155.10:3000

set -e

BASE_URL="${1:-http://localhost:3000}"
TEST_WALLET="5bAMwPjsGKrovga3csb9QX59RE8x3xneSBpDP1t8Hibb"
FAILURES=0

echo "🧪 Running sanity tests against: $BASE_URL"
echo "================================================"

# Test 1: Health check (payment config)
echo -n "1. Testing /api/payment-config... "
RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/test1.json "$BASE_URL/api/payment-config" 2>/dev/null)
if [ "$RESPONSE" = "200" ]; then
    echo "✅ PASS"
else
    echo "❌ FAIL (HTTP $RESPONSE)"
    FAILURES=$((FAILURES + 1))
fi

# Test 2: Pro status endpoint
echo -n "2. Testing /api/pro-status/:wallet... "
RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/test2.json "$BASE_URL/api/pro-status/$TEST_WALLET" 2>/dev/null)
if [ "$RESPONSE" = "200" ]; then
    echo "✅ PASS"
else
    echo "❌ FAIL (HTTP $RESPONSE)"
    FAILURES=$((FAILURES + 1))
fi

# Test 3: Fast aggregate (main data endpoint)
echo -n "3. Testing /api/portfolio/aggregate/fast... "
RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/test3.json -X POST \
    -H "Content-Type: application/json" \
    -d "{\"wallets\":[\"$TEST_WALLET\"]}" \
    "$BASE_URL/api/portfolio/aggregate/fast" 2>/dev/null)
if [ "$RESPONSE" = "200" ]; then
    # Check if response has data
    NET_WORTH=$(cat /tmp/test3.json | grep -o '"totalNetWorth":[0-9.]*' | cut -d: -f2)
    if [ -n "$NET_WORTH" ] && [ "$NET_WORTH" != "0" ]; then
        echo "✅ PASS (net worth: \$$NET_WORTH)"
    else
        echo "❌ FAIL (net worth is 0 or missing)"
        cat /tmp/test3.json | head -c 200
        echo ""
        FAILURES=$((FAILURES + 1))
    fi
else
    echo "❌ FAIL (HTTP $RESPONSE)"
    FAILURES=$((FAILURES + 1))
fi

# Test 4: P&L endpoint
echo -n "4. Testing /api/portfolio/pnl... "
RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/test4.json --max-time 30 -X POST \
    -H "Content-Type: application/json" \
    -d "{\"wallets\":[\"$TEST_WALLET\"]}" \
    "$BASE_URL/api/portfolio/pnl" 2>/dev/null)
if [ "$RESPONSE" = "200" ]; then
    echo "✅ PASS"
else
    echo "❌ FAIL (HTTP $RESPONSE)"
    FAILURES=$((FAILURES + 1))
fi

# Test 5: Dialect endpoint
echo -n "5. Testing /api/portfolio/dialect... "
RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/test5.json --max-time 30 -X POST \
    -H "Content-Type: application/json" \
    -d "{\"wallets\":[\"$TEST_WALLET\"]}" \
    "$BASE_URL/api/portfolio/dialect" 2>/dev/null)
if [ "$RESPONSE" = "200" ]; then
    echo "✅ PASS"
else
    echo "❌ FAIL (HTTP $RESPONSE)"
    FAILURES=$((FAILURES + 1))
fi

# Test 6: Static files (index.html)
echo -n "6. Testing static files... "
RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/test6.html "$BASE_URL/" 2>/dev/null)
if [ "$RESPONSE" = "200" ]; then
    if grep -q "Solana Portfolio" /tmp/test6.html 2>/dev/null; then
        echo "✅ PASS"
    else
        echo "❌ FAIL (missing expected content)"
        FAILURES=$((FAILURES + 1))
    fi
else
    echo "❌ FAIL (HTTP $RESPONSE)"
    FAILURES=$((FAILURES + 1))
fi

# Summary
echo "================================================"
if [ $FAILURES -eq 0 ]; then
    echo "🎉 All tests passed!"
    exit 0
else
    echo "💥 $FAILURES test(s) failed!"
    exit 1
fi

