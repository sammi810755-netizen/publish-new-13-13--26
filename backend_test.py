#!/usr/bin/env python3
"""
Comprehensive backend test suite for Share-as-Link endpoints.
Tests all scenarios specified in the review request.
"""

import requests
import sys
import json
from typing import Dict, Any, Optional

# Base URL from environment (external ingress)
BASE_URL = "https://1b326056-7d53-4eb4-846e-387acfbc61b0.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Test results tracking
test_results = []
passed = 0
failed = 0


def log_test(test_name: str, passed_test: bool, details: str = ""):
    """Log test result"""
    global passed, failed
    status = "✅ PASS" if passed_test else "❌ FAIL"
    result = f"{status}: {test_name}"
    if details:
        result += f"\n    {details}"
    print(result)
    test_results.append({"test": test_name, "passed": passed_test, "details": details})
    if passed_test:
        passed += 1
    else:
        failed += 1


def test_1_sanity_check():
    """Test 1: GET /api/ -> returns {"message":"Hello World"}"""
    try:
        response = requests.get(f"{API_BASE}/", timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data.get("message") == "Hello World":
                log_test("Test 1: Sanity check GET /api/", True, f"Response: {data}")
                return True
            else:
                log_test("Test 1: Sanity check GET /api/", False, f"Unexpected response: {data}")
                return False
        else:
            log_test("Test 1: Sanity check GET /api/", False, f"Status code: {response.status_code}")
            return False
    except Exception as e:
        log_test("Test 1: Sanity check GET /api/", False, f"Exception: {str(e)}")
        return False


def test_2_create_shared_link() -> Optional[Dict[str, str]]:
    """Test 2: POST /api/shared with test data"""
    try:
        payload = {
            "title": "Test Note",
            "body": "Line one.\n- bullet a\n- bullet b",
            "kind": "note"
        }
        response = requests.post(f"{API_BASE}/shared", json=payload, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            # Check all required fields
            if all(key in data for key in ["token", "manage_token", "url"]):
                # Verify URL format
                if data["url"].endswith(f"/api/shared/{data['token']}"):
                    log_test("Test 2: POST /api/shared", True, 
                            f"Token: {data['token']}, URL: {data['url']}")
                    return data
                else:
                    log_test("Test 2: POST /api/shared", False, 
                            f"URL format incorrect: {data['url']}")
                    return None
            else:
                log_test("Test 2: POST /api/shared", False, 
                        f"Missing required fields. Got: {data}")
                return None
        else:
            log_test("Test 2: POST /api/shared", False, 
                    f"Status code: {response.status_code}, Body: {response.text}")
            return None
    except Exception as e:
        log_test("Test 2: POST /api/shared", False, f"Exception: {str(e)}")
        return None


def test_3_get_shared_html(token: str) -> bool:
    """Test 3: GET /api/shared/{token} -> verify HTML rendering"""
    try:
        response = requests.get(f"{API_BASE}/shared/{token}", timeout=10)
        
        if response.status_code == 200:
            # Check Content-Type
            content_type = response.headers.get("content-type", "")
            if "text/html" not in content_type:
                log_test("Test 3: GET /api/shared/{token}", False, 
                        f"Wrong Content-Type: {content_type}")
                return False
            
            html_content = response.text
            # Verify required content
            required_strings = ["Test Note", "Made with Notes AI"]
            missing = [s for s in required_strings if s not in html_content]
            
            # Also check for rendered content (bullets)
            has_content = "bullet a" in html_content and "bullet b" in html_content
            
            if not missing and has_content:
                log_test("Test 3: GET /api/shared/{token}", True, 
                        f"HTML contains title, branding, and rendered content")
                return True
            else:
                log_test("Test 3: GET /api/shared/{token}", False, 
                        f"Missing: {missing}, Has content: {has_content}")
                return False
        else:
            log_test("Test 3: GET /api/shared/{token}", False, 
                    f"Status code: {response.status_code}")
            return False
    except Exception as e:
        log_test("Test 3: GET /api/shared/{token}", False, f"Exception: {str(e)}")
        return False


def test_4_revoke_link(token: str, manage_token: str) -> bool:
    """Test 4: DELETE /api/shared/{token}?key={manage_token}"""
    try:
        response = requests.delete(
            f"{API_BASE}/shared/{token}",
            params={"key": manage_token},
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get("revoked") == True:
                log_test("Test 4: DELETE /api/shared/{token}", True, 
                        f"Link revoked successfully: {data}")
                return True
            else:
                log_test("Test 4: DELETE /api/shared/{token}", False, 
                        f"Unexpected response: {data}")
                return False
        else:
            log_test("Test 4: DELETE /api/shared/{token}", False, 
                    f"Status code: {response.status_code}")
            return False
    except Exception as e:
        log_test("Test 4: DELETE /api/shared/{token}", False, f"Exception: {str(e)}")
        return False


def test_5_get_revoked_link(token: str) -> bool:
    """Test 5: GET /api/shared/{token} after revoke -> expect 404"""
    try:
        response = requests.get(f"{API_BASE}/shared/{token}", timeout=10)
        
        if response.status_code == 404:
            html_content = response.text
            if "Link unavailable" in html_content or "revoked" in html_content:
                log_test("Test 5: GET revoked link", True, 
                        "Returns 404 with unavailable message")
                return True
            else:
                log_test("Test 5: GET revoked link", False, 
                        "404 but missing unavailable message")
                return False
        else:
            log_test("Test 5: GET revoked link", False, 
                    f"Expected 404, got {response.status_code}")
            return False
    except Exception as e:
        log_test("Test 5: GET revoked link", False, f"Exception: {str(e)}")
        return False


def test_6a_wrong_manage_key() -> bool:
    """Test 6a: DELETE with wrong manage key -> expect 403"""
    try:
        # Create a fresh link
        payload = {"title": "Test for wrong key", "body": "test", "kind": "note"}
        response = requests.post(f"{API_BASE}/shared", json=payload, timeout=10)
        if response.status_code != 200:
            log_test("Test 6a: DELETE with wrong key (setup)", False, "Failed to create link")
            return False
        
        data = response.json()
        token = data["token"]
        
        # Try to delete with wrong key
        response = requests.delete(
            f"{API_BASE}/shared/{token}",
            params={"key": "wrongkey123"},
            timeout=10
        )
        
        if response.status_code == 403:
            log_test("Test 6a: DELETE with wrong key", True, "Returns 403 as expected")
            return True
        else:
            log_test("Test 6a: DELETE with wrong key", False, 
                    f"Expected 403, got {response.status_code}")
            return False
    except Exception as e:
        log_test("Test 6a: DELETE with wrong key", False, f"Exception: {str(e)}")
        return False


def test_6b_delete_nonexistent() -> bool:
    """Test 6b: DELETE non-existent token -> expect 404"""
    try:
        response = requests.delete(
            f"{API_BASE}/shared/nonexistent123",
            params={"key": "anykey"},
            timeout=10
        )
        
        if response.status_code == 404:
            log_test("Test 6b: DELETE non-existent token", True, "Returns 404 as expected")
            return True
        else:
            log_test("Test 6b: DELETE non-existent token", False, 
                    f"Expected 404, got {response.status_code}")
            return False
    except Exception as e:
        log_test("Test 6b: DELETE non-existent token", False, f"Exception: {str(e)}")
        return False


def test_6c_empty_body() -> bool:
    """Test 6c: POST with empty body {} -> should still work with defaults"""
    try:
        payload = {}
        response = requests.post(f"{API_BASE}/shared", json=payload, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if all(key in data for key in ["token", "manage_token", "url"]):
                # Try to GET the link to verify it's usable
                token = data["token"]
                get_response = requests.get(f"{API_BASE}/shared/{token}", timeout=10)
                if get_response.status_code == 200:
                    html = get_response.text
                    # Should have default title "Shared note"
                    if "Shared note" in html:
                        log_test("Test 6c: POST with empty body", True, 
                                "Creates usable link with default title")
                        return True
                    else:
                        log_test("Test 6c: POST with empty body", False, 
                                "Link created but missing default title")
                        return False
                else:
                    log_test("Test 6c: POST with empty body", False, 
                            f"Link created but GET failed: {get_response.status_code}")
                    return False
            else:
                log_test("Test 6c: POST with empty body", False, 
                        f"Missing required fields: {data}")
                return False
        else:
            log_test("Test 6c: POST with empty body", False, 
                    f"Status code: {response.status_code}")
            return False
    except Exception as e:
        log_test("Test 6c: POST with empty body", False, f"Exception: {str(e)}")
        return False


def test_7_mongodb_persistence() -> bool:
    """Test 7: Verify MongoDB persistence"""
    try:
        # Create a link
        payload = {"title": "Persistence Test", "body": "Testing MongoDB", "kind": "note"}
        response = requests.post(f"{API_BASE}/shared", json=payload, timeout=10)
        if response.status_code != 200:
            log_test("Test 7: MongoDB persistence (setup)", False, "Failed to create link")
            return False
        
        data = response.json()
        token = data["token"]
        
        # GET it back immediately
        get_response = requests.get(f"{API_BASE}/shared/{token}", timeout=10)
        if get_response.status_code == 200:
            html = get_response.text
            if "Persistence Test" in html and "Testing MongoDB" in html:
                log_test("Test 7: MongoDB persistence", True, 
                        "Document stored and retrieved successfully")
                return True
            else:
                log_test("Test 7: MongoDB persistence", False, 
                        "Document retrieved but content missing")
                return False
        else:
            log_test("Test 7: MongoDB persistence", False, 
                    f"Failed to retrieve: {get_response.status_code}")
            return False
    except Exception as e:
        log_test("Test 7: MongoDB persistence", False, f"Exception: {str(e)}")
        return False


def run_all_tests():
    """Run all tests in sequence"""
    print("=" * 70)
    print("BACKEND SHARE-AS-LINK ENDPOINT TESTS")
    print(f"Base URL: {BASE_URL}")
    print("=" * 70)
    print()
    
    # Test 1: Sanity check
    test_1_sanity_check()
    print()
    
    # Test 2-5: Main flow (create, get, revoke, get after revoke)
    link_data = test_2_create_shared_link()
    print()
    
    if link_data:
        token = link_data["token"]
        manage_token = link_data["manage_token"]
        
        test_3_get_shared_html(token)
        print()
        
        test_4_revoke_link(token, manage_token)
        print()
        
        test_5_get_revoked_link(token)
        print()
    else:
        print("⚠️  Skipping tests 3-5 due to test 2 failure")
        print()
    
    # Test 6: Negative cases
    test_6a_wrong_manage_key()
    print()
    
    test_6b_delete_nonexistent()
    print()
    
    test_6c_empty_body()
    print()
    
    # Test 7: Persistence
    test_7_mongodb_persistence()
    print()
    
    # Summary
    print("=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    print(f"Total tests: {passed + failed}")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    print()
    
    if failed == 0:
        print("🎉 ALL TESTS PASSED!")
        return 0
    else:
        print(f"⚠️  {failed} test(s) failed. See details above.")
        return 1


if __name__ == "__main__":
    exit_code = run_all_tests()
    sys.exit(exit_code)
