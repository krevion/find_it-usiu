from datetime import date
from io import BytesIO
from tempfile import TemporaryDirectory

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image

from .models import Claim, FoundItem


@override_settings(
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"]
)
class FoundItemApiTests(TestCase):
    def setUp(self):
        self.media_directory = TemporaryDirectory()
        self.settings_override = override_settings(MEDIA_ROOT=self.media_directory.name)
        self.settings_override.enable()
        cache.clear()
        self.security_user = get_user_model().objects.create_user(
            username="security",
            email="security@example.com",
            password="test-security-password",
            is_staff=True,
        )

    def tearDown(self):
        cache.clear()
        self.settings_override.disable()
        self.media_directory.cleanup()

    def make_photo(self, filename="item.png"):
        image_buffer = BytesIO()
        Image.new("RGB", (10, 10), color="blue").save(image_buffer, format="PNG")
        return SimpleUploadedFile(filename, image_buffer.getvalue(), content_type="image/png")

    def found_item_data(self, **overrides):
        data = {
            "item_name": "Blue water bottle",
            "category": "Other",
            "description": "A blue bottle with a sticker.",
            "photo": self.make_photo(),
            "location_found": "Library",
            "date_found": date.today().isoformat(),
            "finder_name": "Finder",
            "finder_contact": "finder@example.com",
            "security_question": "What sticker is on the bottle?",
            "security_answer": "USIU",
        }
        data.update(overrides)
        return data

    def create_found_item(self):
        self.client.force_login(self.security_user)
        response = self.client.post("/found/", self.found_item_data())
        self.assertEqual(response.status_code, 201)
        return response.json()["id"]

    def test_found_item_submission_requires_security_access(self):
        response = self.client.post("/found/", self.found_item_data())

        self.assertEqual(response.status_code, 403)
        self.assertFalse(FoundItem.objects.exists())

    def test_submit_found_item_stores_photo_and_hashes_answer(self):
        self.client.force_login(self.security_user)
        response = self.client.post("/found/", self.found_item_data())

        self.assertEqual(response.status_code, 201)
        item = FoundItem.objects.get(pk=response.json()["id"])
        self.assertTrue(item.photo.name.startswith("found_items/"))
        self.assertNotEqual(item.security_answer_hash, "usiu")
        self.assertTrue(item.verify_security_answer(" usiu "))
        self.assertEqual(item.uploaded_by, self.security_user)

    def test_submit_rejects_non_image_upload(self):
        self.client.force_login(self.security_user)
        response = self.client.post(
            "/found/",
            self.found_item_data(
                photo=SimpleUploadedFile(
                    "item.png", b"not an image", content_type="image/png"
                )
            ),
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(FoundItem.objects.exists())

    def test_found_listing_does_not_expose_finder_contact_or_answer_hash(self):
        item = FoundItem(**{
            key: value
            for key, value in self.found_item_data().items()
            if key not in {"photo", "security_answer"}
        })
        item.photo = self.make_photo()
        item.set_security_answer("USIU")
        item.save()

        response = self.client.get("/found/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("csrftoken", response.cookies)
        result = response.json()["results"][0]
        self.assertEqual(result["category"], item.category)
        self.assertEqual(result["security_question"], item.security_question)
        self.assertNotIn("finder_contact", result)
        self.assertNotIn("security_answer_hash", result)

    def test_claim_answer_verification_and_rate_limit(self):
        item_id = self.create_found_item()
        claim_data = {
            "claimant_name": "Student",
            "claimant_email": "student@example.com",
            "answer": "wrong",
        }

        for _ in range(5):
            wrong_response = self.client.post(
                f"/found/{item_id}/claim/", claim_data
            )
            self.assertEqual(wrong_response.status_code, 400)

        claim_data["answer"] = "USIU"
        limited_response = self.client.post(f"/found/{item_id}/claim/", claim_data)
        self.assertEqual(limited_response.status_code, 429)
        self.assertFalse(Claim.objects.exists())

        cache.clear()
        claim_data["answer"] = " usiu "
        claim_response = self.client.post(
            f"/found/{item_id}/claim/", claim_data
        )
        self.assertEqual(claim_response.status_code, 201)
        claim = Claim.objects.get(pk=claim_response.json()["id"])
        self.assertTrue(claim.answer_verified)
        self.assertEqual(claim.status, Claim.Status.PENDING)
        self.assertFalse(hasattr(claim, "answer"))

    def test_security_login_and_claim_review_require_staff(self):
        response = self.client.post(
            "/security/login/",
            {"username": "security", "password": "test-security-password"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["authenticated"])

        item_id = self.create_found_item()
        claim_response = self.client.post(
            f"/found/{item_id}/claim/",
            {
                "claimant_name": "Student",
                "claimant_email": "student@example.com",
                "answer": "USIU",
            },
        )
        self.assertEqual(claim_response.status_code, 201)
        claim_id = claim_response.json()["id"]

        claims_response = self.client.get("/security/claims/")
        self.assertEqual(claims_response.status_code, 200)
        self.assertEqual(claims_response.json()["results"][0]["id"], claim_id)

        decision_response = self.client.post(
            f"/security/claims/{claim_id}/decision/",
            {"status": Claim.Status.APPROVED},
        )
        self.assertEqual(decision_response.status_code, 200)
        claim = Claim.objects.get(pk=claim_id)
        self.assertEqual(claim.reviewed_by, self.security_user)
        self.assertIsNotNone(claim.reviewed_at)
        item = FoundItem.objects.get(pk=item_id)
        self.assertEqual(item.status, FoundItem.Status.RETURNED)

        duplicate_claim = self.client.post(
            f"/found/{item_id}/claim/",
            {
                "claimant_name": "Another Student",
                "claimant_email": "another@example.com",
                "answer": "USIU",
            },
        )
        self.assertEqual(duplicate_claim.status_code, 409)

    def test_non_staff_cannot_sign_in_as_security(self):
        get_user_model().objects.create_user(
            username="student",
            password="test-student-password",
            is_staff=False,
        )
        response = self.client.post(
            "/security/login/",
            {"username": "student", "password": "test-student-password"},
        )
        self.assertEqual(response.status_code, 401)

    def test_security_claim_list_requires_authenticated_staff(self):
        response = self.client.get("/security/claims/")
        self.assertEqual(response.status_code, 401)
